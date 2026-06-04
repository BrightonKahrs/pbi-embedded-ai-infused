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
 * Add a new page to the supplied embedded report, materialise the supplied
 * `VisualConfig` on it, and best-effort persist the report. Returns the
 * `{ visualId, pageName }` of the newly created visual so the caller can
 * display it via Power BI's visual embed type.
 *
 * The flow mirrors `AuthorVisualAIView`'s `createNewPageForVisual` +
 * `applyVisualConfig` + save logic. Power BI's authoring API is finicky so
 * we deliberately copy the known-good sequence rather than reinvent it.
 */
export async function pinInlineVisualToReport(
  report: Report,
  config: VisualConfig
): Promise<PinResult> {
  const newPageName = `AI_Inline_${Date.now()}`;

  // 1. Create a fresh page to host the visual.
  try {
    await report.addPage(newPageName);
  } catch (error) {
    console.error('inlineVisualPinner: failed to add page', error);
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
    console.warn('inlineVisualPinner: could not set new page active', error);
  }

  // 2. Create the visual on the new page.
  let visualResponse: any;
  try {
    visualResponse = await (newPage as any).createVisual(
      config.visualType,
      VISUAL_LAYOUT
    );
  } catch (error) {
    console.error('inlineVisualPinner: createVisual failed', error);
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

  return { visualId: visual.name, pageName: newPage.name };
}
