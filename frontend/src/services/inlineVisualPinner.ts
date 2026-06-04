import { Report } from 'powerbi-client';
import 'powerbi-report-authoring';
import { VisualConfig } from './api';

// Power BI authoring schema URIs. Replicated from AuthorVisualAIView so this
// service does not depend on the modal component.
const schemas = {
  column: 'http://powerbi.com/product/schema#column',
  measure: 'http://powerbi.com/product/schema#measure',
  property: 'http://powerbi.com/product/schema#property',
};

// Default tile for the pinned visual. Authoring against the report happens at
// the report's authored canvas resolution, but the widget tile rendered via
// the visual-embed type rescales to fit the surrounding container — so we
// pick an aspect ratio that matches the widget tile (~1.875:1) and a modest
// authored size so even a fallback non-scaling render fits the tile without
// cropping axis labels.
const VISUAL_LAYOUT = {
  x: 0,
  y: 0,
  width: 600,
  height: 320,
  displayState: { mode: 0 },
};

const SAVE_TIMEOUT_MS = 30000;

export interface PinResult {
  visualId: string;
  pageName: string;
}

export interface MaterializeOptions {
  /** Prefix for the auto-generated page name. Defaults to `AI_Inline`. */
  pageNamePrefix?: string;
  /** Partial layout overrides merged onto the default `VISUAL_LAYOUT`. */
  layout?: Partial<typeof VISUAL_LAYOUT>;
  /** When true, the first `setProperty` failure aborts the whole flow and
   *  the function resolves to `null`. Used by the inline preview path —
   *  property writes 401 against the service for in-memory visuals, so
   *  there's no point continuing to try every property. The pin-to-widgets
   *  path leaves this false (default) so a missing decorative property
   *  doesn't kill an otherwise successful pin. */
  abortOnPropertyFailure?: boolean;
}

/**
 * Coerce an arbitrary Power BI SDK rejection (often a plain object with
 * `detailedMessage` and no `.message`) into a non-empty string so the caller
 * can surface a useful error instead of "undefined".
 */
function extractErrorMessage(error: unknown): string {
  if (!error) return 'unknown error';
  if (typeof error === 'string') return error;
  const anyErr = error as any;
  if (typeof anyErr.message === 'string' && anyErr.message) return anyErr.message;
  if (typeof anyErr.detailedMessage === 'string' && anyErr.detailedMessage) {
    return anyErr.detailedMessage;
  }
  try {
    const json = JSON.stringify(error);
    if (json && json !== '{}') return json;
  } catch {
    /* fall through */
  }
  return String(error);
}

/**
 * Re-throw a non-Error rejection from the Power BI authoring SDK as an Error
 * whose `.message` is a human-readable description prefixed with `phase`, so
 * upstream code that does `error?.message || String(error)` works.
 */
function rethrowWithContext(phase: string, error: unknown): never {
  throw new Error(`${phase}: ${extractErrorMessage(error)}`);
}

/**
 * Shared internals for both `pinInlineVisualToReport` (pin + save) and
 * `createInlineVisualOnly` (in-memory only). Creates a fresh page,
 * materialises the visual on it, binds data fields, and sets
 * title/display properties.
 *
 * Returns `null` when `abortOnPropertyFailure` is set and a `setProperty`
 * call rejected — the caller should fall back to its own renderer.
 */
async function _materializeVisual(
  report: Report,
  config: VisualConfig,
  opts: MaterializeOptions = {}
): Promise<PinResult | null> {
  const prefix = opts.pageNamePrefix ?? 'AI_Inline';
  const newPageName = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const layout = { ...VISUAL_LAYOUT, ...(opts.layout ?? {}) };
  const abortOnPropertyFailure = !!opts.abortOnPropertyFailure;

  // 1. Create a fresh page to host the visual.
  try {
    await report.addPage(newPageName);
  } catch (error) {
    console.debug('inlineVisualPinner: failed to add page', error);
    rethrowWithContext(
      'could not add new page (the report must be embedded in Edit mode to author visuals)',
      error
    );
  }

  const pages = await report.getPages();
  const newPage = pages.find(
    p => p.name === newPageName || p.displayName === newPageName
  );
  if (!newPage) {
    throw new Error(`inlineVisualPinner: could not find newly created page "${newPageName}"`);
  }

  try {
    await newPage.setActive();
  } catch (error) {
    console.debug('inlineVisualPinner: could not set new page active', error);
  }

  // 2. Create the visual on the new page.
  let visualResponse: any;
  try {
    visualResponse = await (newPage as any).createVisual(
      config.visualType,
      layout
    );
  } catch (error) {
    console.debug('inlineVisualPinner: createVisual failed', error);
    rethrowWithContext(`could not create ${config.visualType} visual`, error);
  }
  const visual = visualResponse.visual;
  if (!visual) {
    throw new Error('inlineVisualPinner: createVisual returned no visual');
  }

  // 3. Bind data fields (failures on individual fields are non-fatal).
  for (const field of config.dataFields) {
    try {
      const isMeasure = !!field.isMeasure;
      await visual.addDataField(field.dataRole, {
        table: field.table,
        [isMeasure ? 'measure' : 'column']: field.column,
        schema: isMeasure ? schemas.measure : schemas.column,
      });
    } catch (fieldError) {
      console.debug(
        `inlineVisualPinner: failed to add field ${field.dataRole} (${field.table}[${field.column}])`,
        fieldError
      );
    }
  }

  // 4-5. Properties (title + display). In the inline-preview path these
  // 401 against the service because the visual is in-memory only, so we
  // wrap the whole batch in a single try/catch and bail out on the first
  // failure rather than spamming the console with one warning per property.
  type PropertySpec = {
    objectName: string;
    propertyName: string;
    value: unknown;
  };
  const propertySpecs: PropertySpec[] = [];
  if (config.title) {
    propertySpecs.push(
      { objectName: 'title', propertyName: 'show', value: true },
      { objectName: 'title', propertyName: 'text', value: config.title },
      { objectName: 'title', propertyName: 'textSize', value: 25 }
    );
  }
  if (config.properties) {
    if (config.properties.showLegend !== undefined) {
      propertySpecs.push({
        objectName: 'legend',
        propertyName: 'show',
        value: config.properties.showLegend,
      });
    }
    if (config.properties.showXAxis !== undefined) {
      propertySpecs.push({
        objectName: 'categoryAxis',
        propertyName: 'show',
        value: config.properties.showXAxis,
      });
    }
    if (config.properties.showYAxis !== undefined) {
      propertySpecs.push({
        objectName: 'valueAxis',
        propertyName: 'show',
        value: config.properties.showYAxis,
      });
    }
  }

  try {
    for (const spec of propertySpecs) {
      await visual.setProperty(
        { objectName: spec.objectName, propertyName: spec.propertyName },
        { schema: schemas.property, value: spec.value }
      );
    }
  } catch (err) {
    console.debug(
      'inlineVisualPinner: setProperty failed; ' +
        (abortOnPropertyFailure ? 'aborting' : 'continuing'),
      err
    );
    if (abortOnPropertyFailure) {
      return null;
    }
    // For the pin-to-widgets path a single decorative property failure
    // shouldn't kill the pin — the visual itself was created successfully
    // and save() can still persist it.
  }

  return { visualId: visual.name, pageName: newPage.name };
}

/**
 * Add a new page to the supplied embedded report, materialise the supplied
 * `VisualConfig` on it, and best-effort persist the report. Returns the
 * `{ visualId, pageName }` of the newly created visual so the caller can
 * display it via Power BI's visual embed type.
 */
export async function pinInlineVisualToReport(
  report: Report,
  config: VisualConfig
): Promise<PinResult> {
  const result = await _materializeVisual(report, config);
  if (!result) {
    // _materializeVisual only returns null when abortOnPropertyFailure is
    // set (and this code path does not set it). Defensive.
    throw new Error('inlineVisualPinner: failed to materialise visual');
  }

  // 6. Best-effort save. The visual exists in the in-memory report regardless
  // of whether persistence succeeds, which is enough for the widgets tab to
  // render it via the visual embed type, so save failures are logged only.
  try {
    const savePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Save timeout - no saved event received'));
      }, SAVE_TIMEOUT_MS);
      report.on('saved', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    await report.save();
    await savePromise;
  } catch (saveError) {
    console.debug(
      'inlineVisualPinner: report.save() did not complete cleanly; the visual is pinned to the in-memory report only.',
      saveError
    );
  }

  return result;
}

/**
 * Same as `pinInlineVisualToReport` but skips `report.save()`. Use this when
 * you want to materialise a visual purely in the in-memory report so it can
 * be embedded with the `visual` embed type without dirtying the saved
 * report.
 *
 * Resolves to `null` if any `setProperty` call rejected — the consumer
 * (e.g. `InlinePowerBIVisual`) treats that as a signal to fall back to its
 * Recharts renderer.
 */
export async function createInlineVisualOnly(
  report: Report,
  config: VisualConfig,
  opts: MaterializeOptions = {}
): Promise<PinResult | null> {
  return _materializeVisual(report, config, {
    ...opts,
    abortOnPropertyFailure: opts.abortOnPropertyFailure ?? true,
  });
}
