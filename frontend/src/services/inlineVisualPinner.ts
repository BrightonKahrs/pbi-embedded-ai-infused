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

const VISUAL_LAYOUT = {
  x: 20,
  y: 20,
  width: 1240,
  height: 680,
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
 * Shared internals for both `pinInlineVisualToReport` (pin + save) and
 * `createInlineVisualOnly` (in-memory only). Creates a fresh page, materialises
 * the visual on it, binds data fields, and sets title/display properties.
 *
 * The flow mirrors `AuthorVisualAIView`'s `createNewPageForVisual` +
 * `applyVisualConfig`. Power BI's authoring API is finicky so we deliberately
 * copy the known-good sequence rather than reinvent it.
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
    console.error('inlineVisualPinner: failed to add page', error);
    throw error;
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
    console.warn('inlineVisualPinner: could not set new page active', error);
  }

  // 2. Create the visual on the new page.
  const visualResponse = await (newPage as any).createVisual(
    config.visualType,
    layout
  );
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
      console.warn(
        `inlineVisualPinner: failed to add field ${field.dataRole} (${field.table}[${field.column}])`,
        fieldError
      );
    }
  }

  // 4. Title (one try/catch per property so a single failure doesn't abort).
  if (config.title) {
    try {
      await visual.setProperty(
        { objectName: 'title', propertyName: 'show' },
        { schema: schemas.property, value: true }
      );
    } catch (err) {
      console.warn('inlineVisualPinner: failed to set title.show', err);
    }
    try {
      await visual.setProperty(
        { objectName: 'title', propertyName: 'text' },
        { schema: schemas.property, value: config.title }
      );
    } catch (err) {
      console.warn('inlineVisualPinner: failed to set title.text', err);
    }
    try {
      await visual.setProperty(
        { objectName: 'title', propertyName: 'textSize' },
        { schema: schemas.property, value: 25 }
      );
    } catch (err) {
      console.warn('inlineVisualPinner: failed to set title.textSize', err);
    }
  }

  // 5. Display properties.
  if (config.properties) {
    if (config.properties.showLegend !== undefined) {
      try {
        await visual.setProperty(
          { objectName: 'legend', propertyName: 'show' },
          { schema: schemas.property, value: config.properties.showLegend }
        );
      } catch (err) {
        console.warn('inlineVisualPinner: failed to set legend.show', err);
      }
    }
    if (config.properties.showXAxis !== undefined) {
      try {
        await visual.setProperty(
          { objectName: 'categoryAxis', propertyName: 'show' },
          { schema: schemas.property, value: config.properties.showXAxis }
        );
      } catch (err) {
        console.warn('inlineVisualPinner: failed to set categoryAxis.show', err);
      }
    }
    if (config.properties.showYAxis !== undefined) {
      try {
        await visual.setProperty(
          { objectName: 'valueAxis', propertyName: 'show' },
          { schema: schemas.property, value: config.properties.showYAxis }
        );
      } catch (err) {
        console.warn('inlineVisualPinner: failed to set valueAxis.show', err);
      }
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
    console.warn(
      'inlineVisualPinner: report.save() did not complete cleanly; the visual is pinned to the in-memory report only.',
      saveError
    );
  }

  return result;
}

/**
 * Same as `pinInlineVisualToReport` but skips `report.save()`. Use this when
 * you want to materialise a visual purely in the in-memory report so it can
 * be embedded with the `visual` embed type without dirtying the saved report.
 *
 * The created visual lives only on the current embedded session's report
 * model; it disappears when the report is reloaded.
 */
export async function createInlineVisualOnly(
  report: Report,
  config: VisualConfig,
  opts: MaterializeOptions = {}
): Promise<PinResult> {
  return _materializeVisual(report, config, opts);
}
