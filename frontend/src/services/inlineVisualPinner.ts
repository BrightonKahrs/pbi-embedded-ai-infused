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
 * `createInlineVisualOnly` (save-and-embed). Creates a fresh page,
 * materialises the visual on it, binds data fields, and sets
 * title/display properties. Persistence (`report.save()`) is the
 * responsibility of the caller.
 */
async function _materializeVisual(
  report: Report,
  config: VisualConfig,
  opts: MaterializeOptions = {}
): Promise<PinResult> {
  const prefix = opts.pageNamePrefix ?? 'AI_Inline';
  const newPageName = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const layout = { ...VISUAL_LAYOUT, ...(opts.layout ?? {}) };

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

  // 4-5. Properties (title + display). On a SAVED visual these now reach
  // the service successfully; the previous in-memory path 401'd, but with
  // `report.save()` writing the visual server-side this batch should work.
  // We still treat individual property failures as non-fatal — a missing
  // decorative property must not kill an otherwise valid visual. Surface
  // them as warnings so real regressions are visible in the devtools.
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

  for (const spec of propertySpecs) {
    try {
      await visual.setProperty(
        { objectName: spec.objectName, propertyName: spec.propertyName },
        { schema: schemas.property, value: spec.value }
      );
    } catch (err) {
      console.warn(
        `inlineVisualPinner: setProperty ${spec.objectName}.${spec.propertyName} failed`,
        err
      );
    }
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
 * Materialise an inline visual on a fresh page AND persist via
 * `report.save()` so the visual exists server-side. This is required for
 * the second iframe (the inline chat visual embed) to fetch the visual:
 * an unsaved in-memory visual gets 401'd by the service.
 *
 * Returns `null` when the save step fails (e.g. the user lacks edit
 * permissions on the report). Callers should fall back to their own
 * renderer (Recharts) in that case.
 */
export async function createInlineVisualOnly(
  report: Report,
  config: VisualConfig,
  opts: MaterializeOptions = {}
): Promise<PinResult | null> {
  const result = await _materializeVisual(report, config, opts);

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
    console.warn(
      'inlineVisualPinner: report.save() failed; falling back to non-PBI render',
      saveError
    );
    // Best-effort: try to remove the orphan page we created so we don't
    // leak a stray empty page in the in-memory report.
    try {
      await report.deletePage(result.pageName);
    } catch {
      /* non-fatal */
    }
    return null;
  }

  return result;
}

/**
 * Remove every page whose name or displayName looks like an AI-generated
 * inline-chat page (prefix `AI_InlineChat`). Best-effort: failures are
 * swallowed so this never breaks the chat shell.
 *
 * Run at chat-shell mount so a fresh session starts with a clean report.
 */
export async function cleanupAIPages(report: Report): Promise<void> {
  if (!report) return;
  try {
    const pages = await report.getPages();
    const stale = pages.filter((p) => {
      const name = (p as any).name ?? '';
      const displayName = (p as any).displayName ?? '';
      return (
        typeof name === 'string' &&
        (name.startsWith('AI_InlineChat') ||
          displayName.startsWith('AI_InlineChat'))
      );
    });
    if (stale.length === 0) return;

    // If we're about to delete the active page, switch off it first so
    // the SDK doesn't reject the delete.
    try {
      const remaining = pages.find(
        (p) =>
          !stale.some(
            (s) => ((s as any).name ?? '') === ((p as any).name ?? '')
          )
      );
      if (remaining) {
        try {
          await remaining.setActive();
        } catch {
          /* non-fatal */
        }
      }
    } catch {
      /* non-fatal */
    }

    for (const page of stale) {
      const pageName = (page as any).name as string | undefined;
      if (!pageName) continue;
      try {
        await report.deletePage(pageName);
      } catch (err) {
        // Silent — the page may already be gone, or the report may not be
        // in authoring mode. Either way, leftover pages are harmless.
        console.debug(
          `cleanupAIPages: could not delete page "${pageName}"`,
          err
        );
      }
    }
  } catch (err) {
    console.debug('cleanupAIPages: enumerating pages failed', err);
  }
}
