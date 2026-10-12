// Genera el informe «Rendimiento DAX 2.0 · las demos» (PBIR) a partir de la spec _brief/report-spec.md.
//   node _brief/generar-informe.mjs PowerBi/PowerBi.Report
// Reescribe: tema «Terminal DAX», report.json, pages/ y quita los marcadores antiguos. No toca el modelo.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = path.resolve(process.argv[2] ?? 'PowerBi/PowerBi.Report');
const def = path.join(dir, 'definition');
const SCH = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/';
const VISUAL_SCHEMA = SCH + 'visualContainer/2.9.0/schema.json';
const PAGE_SCHEMA = SCH + 'page/2.1.0/schema.json';

// ---------- paleta «Terminal DAX» ----------
const C = {
  bg: '#050d0a', surface: '#0a1a14', text: '#d6efe3', muted: '#7fa595', border: '#17352a',
  green: '#3dfc8f', amber: '#ffb347', red: '#ff5c6c', blue: '#5fd4ff', band: '#0f2a20',
};
const FONT = { title: 'Segoe UI Semibold', body: 'Segoe UI', mono: 'Cascadia Mono' };
const MEASURE_COLOR = {
  'Sales Amount': C.text, 'Ventas': C.text,
  'Total Sales Currency Dolar': C.blue, 'Total Sales Currency Euro': C.amber, 'Total Sales Currency v4': C.green,
  'Ventas AA · SPLY': C.blue, 'Ventas AA · Offset día': C.amber, 'Ventas AA · Calendario': C.red, 'Ventas AA · Columna': C.green,
  'Cuadre 29-feb · SPLY': C.blue, 'Cuadre 29-feb · Offset': C.amber, 'Cuadre 29-feb · Calendario': C.red, 'Cuadre 29-feb · Columna': C.green,
};

// ---------- utilidades PBIR ----------
const id20 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 20);
const lit = (v) => ({ expr: { Literal: { Value: typeof v === 'string' ? `'${v}'` : typeof v === 'boolean' ? String(v) : Number.isInteger(v) ? `${v}L` : `${v}D` } } });
const D = (n) => ({ expr: { Literal: { Value: `${n}D` } } });
const L = (n) => ({ expr: { Literal: { Value: `${n}L` } } });
const col = (hex) => ({ solid: { color: { expr: { Literal: { Value: `'${hex}'` } } } } });
const props = (p, selector) => selector ? { properties: p, selector } : { properties: p };
const field = {
  col: (t, c) => ({ Column: { Expression: { SourceRef: { Entity: t } }, Property: c } }),
  mea: (t, m) => ({ Measure: { Expression: { SourceRef: { Entity: t } }, Property: m } }),
};
const proj = (f, t, n, extra = {}) => ({ field: f, queryRef: `${t}.${n}`, nativeQueryRef: n, ...extra });
const C_ = (t, c, extra) => proj(field.col(t, c), t, c, extra);
const M_ = (t, m, extra) => proj(field.mea(t, m), t, m, extra);
const IS = 'Internet Sales';

// ---------- rejilla 12×12 → píxeles (1920×1080, margen 32, separación 24, ajuste a 8) ----------
const CANVAS = { w: 1920, h: 1080, m: 32, g: 24 };
const cw = (CANVAS.w - 2 * CANVAS.m - 11 * CANVAS.g) / 12;
const rh = (CANVAS.h - 2 * CANVAS.m - 11 * CANVAS.g) / 12;
const snap = (v) => Math.round(v / 8) * 8;
function box([c1, r1, c2, r2]) {
  const x = snap(CANVAS.m + (c1 - 1) * (cw + CANVAS.g));
  const y = snap(CANVAS.m + (r1 - 1) * (rh + CANVAS.g));
  const xr = snap(CANVAS.m + (c2 - 1) * (cw + CANVAS.g) - CANVAS.g);
  const yb = snap(CANVAS.m + (r2 - 1) * (rh + CANVAS.g) - CANVAS.g);
  return { x, y, width: xr - x, height: yb - y };
}
// reparte una región en `n` ranuras iguales (horizontal) con la separación de la rejilla
function slot(region, i, n) {
  const b = box(region);
  const w = Math.floor((b.width - (n - 1) * CANVAS.g) / n / 8) * 8;
  return { x: b.x + i * (w + CANVAS.g), y: b.y, width: w, height: b.height };
}

// ---------- contenedor común (VCO) ----------
function vco({ title, alt, bg = true, padding = 8 }) {
  const o = {};
  if (title) {
    o.title = [props({
      show: lit(true), text: lit(title), alignment: lit('left'), fontFamily: lit(FONT.title), fontSize: D(14),
      bold: lit(false), fontColor: col(C.text),
    })];
  } else {
    o.title = [props({ show: lit(false) })];
  }
  o.background = [props({ show: lit(bg), color: col(C.surface), transparency: D(0) })];
  o.border = [props({ show: lit(bg), color: col(C.border), radius: D(8), width: D(1) })];
  o.visualHeader = [props({ show: lit(false) })];
  o.padding = [props({ top: D(padding), bottom: D(padding), left: D(padding), right: D(padding) })];
  if (alt) o.general = [props({ altText: lit(alt) })];
  return o;
}

let tab = 0;
function visual(page, key, pos, body, z) {
  const name = id20(`${page}/${key}`);
  const v = {
    $schema: VISUAL_SCHEMA, name,
    position: { x: pos.x, y: pos.y, z: z ?? tab * 1000, height: pos.height, width: pos.width, tabOrder: tab * 1000 },
    visual: body,
  };
  tab += 1;
  return { name, json: v, key };
}

// ---------- constructores de visuales ----------
function textbox(page, key, region, text, { size = 28, font = FONT.title, color = C.text, align = 'left', paras, alt } = {}) {
  const b = typeof region[0] === 'number' && region.length === 4 ? box(region) : region;
  const paragraphs = (paras ?? [text]).map((t) => ({
    textRuns: [{ value: t, textStyle: { fontFamily: font, fontSize: `${size}px`, color } }],
    horizontalTextAlignment: align,
  }));
  return visual(page, key, b, {
    visualType: 'textbox',
    objects: { general: [{ properties: { paragraphs } }] },
    visualContainerObjects: {
      background: [props({ show: lit(false) })], border: [props({ show: lit(false) })],
      padding: [props({ top: D(0), bottom: D(0), left: D(0), right: D(0) })],
      ...(alt ? { general: [props({ altText: lit(alt) })] } : {}),
    },
  });
}

function slicer(page, key, pos, [t, c], header, { mode = 'Dropdown', alt } = {}) {
  pos = { ...pos, height: 80 }; // 60 de cromo + 2×8 de relleno; entra en la banda superior (64) y la separación (16)
  return visual(page, key, pos, {
    visualType: 'slicer',
    query: { queryState: { Values: { projections: [C_(t, c)] } } },
    objects: {
      data: [props({ mode: lit(mode) })],
      header: [props({ show: lit(true), text: lit(header), fontFamily: lit(FONT.title), textSize: D(10), fontColor: col(C.muted) })],
      items: [props({ fontFamily: lit(FONT.body), textSize: D(11), fontColor: col(C.text), background: col(C.surface) })],
    },
    visualContainerObjects: {
      background: [props({ show: lit(true), color: col(C.surface), transparency: D(0) })],
      border: [props({ show: lit(true), color: col(C.border), radius: D(8), width: D(1) })],
      visualHeader: [props({ show: lit(false) })],
      padding: [props({ top: D(8), bottom: D(8), left: D(8), right: D(8) })],
      general: [props({ altText: lit(alt ?? `Segmentador de ${header}`) })],
    },
  });
}

function card(page, key, region, measure, label, { alt } = {}) {
  const color = MEASURE_COLOR[measure] ?? C.text;
  const b = region.x !== undefined ? region : box(region);
  const sel = { id: 'default' };
  return visual(page, key, b, {
    visualType: 'cardVisual',
    query: { queryState: { Data: { projections: [M_(IS, measure)] } } },
    objects: {
      value: [props({ fontFamily: lit(FONT.mono), fontSize: D(40), bold: lit(true), fontColor: col(color), labelDisplayUnits: lit(1000000), labelPrecision: L(1) }, sel)],
      label: [props({ show: lit(true), text: lit(label), fontFamily: lit(FONT.title), fontSize: D(16), fontColor: col(C.muted) }, sel)],
      accentBar: [props({ show: lit(true), position: lit('Left'), width: D(6), color: col(color) }, sel)],
      outline: [props({ show: lit(false) }, sel)],
      fillCustom: [props({ show: lit(true), fillColor: col(C.surface), transparency: D(0) }, sel)],
    },
    visualContainerObjects: vco({ alt: alt ?? `${label}: cifra total`, padding: 0 }),
  });
}

function measureDataPoints(measures) {
  return measures.map((m) => props({ fill: col(MEASURE_COLOR[m] ?? C.green) }, { metadata: `${IS}.${m}` }));
}

function chart(page, key, region, type, { title, alt, cat, measures, sortBy, legend = false, units = 1000000, lines = false }) {
  const b = region.x !== undefined ? region : box(region);
  const state = { Y: { projections: measures.map((m) => M_(IS, m)) } };
  if (cat.length) state.Category = { projections: cat.map(([t, c]) => C_(t, c, { active: true })) };
  const query = { queryState: state };
  if (sortBy) {
    query.sortDefinition = {
      sort: [{ field: sortBy.measure ? field.mea(IS, sortBy.measure) : field.col(...sortBy.col), direction: sortBy.dir ?? 'Descending' }],
      isDefaultSort: true,
    };
  }
  const objects = {
    categoryAxis: [props({ show: lit(true), labelColor: col(C.muted), fontFamily: lit(FONT.body), fontSize: D(11), showAxisTitle: lit(false), gridlineShow: lit(false) })],
    valueAxis: [props({ show: lit(true), labelColor: col(C.muted), fontFamily: lit(FONT.mono), fontSize: D(10), showAxisTitle: lit(false), gridlineShow: lit(true), gridlineColor: col(C.border), gridlineStyle: lit('dotted'), labelDisplayUnits: D(units), start: D(0) })],
    labels: [props({ show: lit(!lines), color: col(C.text), fontFamily: lit(FONT.mono), fontSize: D(10), labelDisplayUnits: D(units), labelPrecision: L(0) })],
    legend: [props({ show: lit(legend), position: lit('Top'), labelColor: col(C.text), fontFamily: lit(FONT.body), fontSize: D(11) })],
    dataPoint: measureDataPoints(measures),
  };
  if (lines) {
    objects.lineStyles = [
      props({ strokeWidth: D(3), showMarker: lit(true), markerSize: D(7), lineChartType: lit('linear') }),
      ...measures.map((m, i) => props({ markerShape: lit(['circle', 'diamond', 'square', 'triangle'][i % 4]), strokeWidth: D(3), lineStyle: lit(i === 1 ? 'dashed' : 'solid') }, { metadata: `${IS}.${m}` })),
    ];
    objects.dataPoint = measures.map((m) => props({ fill: col(MEASURE_COLOR[m] ?? C.green) }, { metadata: `${IS}.${m}` }));
    objects.legend = [props({ show: lit(true), position: lit('Top'), labelColor: col(C.text), fontFamily: lit(FONT.body), fontSize: D(11), legendMarkerRendering: lit('lineAndMarker') })];
  }
  return visual(page, key, b, { visualType: type, query, objects, visualContainerObjects: vco({ title, alt }) });
}

function table(page, key, region, { title, alt, cols, measures, sortBy, filter, numberCols }) {
  const b = region.x !== undefined ? region : box(region);
  const proj_ = [
    ...cols.map(([t, c, disp]) => C_(t, c, disp ? { displayName: disp } : {})),
    ...measures.map(([m, disp]) => M_(IS, m, disp ? { displayName: disp } : {})),
  ];
  const v = {
    visualType: 'tableEx',
    query: { queryState: { Values: { projections: proj_ } } },
    objects: {
      columnHeaders: [props({ autoSizeColumnWidth: lit(true), columnAdjustment: lit('growToFit'), fontFamily: lit(FONT.title), fontSize: D(12), bold: lit(false), fontColor: col(C.text), backColor: col(C.band), outlineStyle: lit('None') })],
      values: [props({ fontFamily: lit(FONT.mono), fontSize: D(12), fontColorPrimary: col(C.text), fontColorSecondary: col(C.text), backColorPrimary: col(C.surface), backColorSecondary: col('#0d211a'), outlineStyle: lit('None') })],
      grid: [props({ gridVertical: lit(false), gridHorizontal: lit(true), gridHorizontalColor: col(C.border), rowPadding: D(4) })],
    },
    visualContainerObjects: { ...vco({ title, alt }), stylePreset: [props({ name: lit('None') })] },
  };
  if (sortBy) {
    v.query.sortDefinition = {
      sort: [{ field: sortBy.measure ? field.mea(IS, sortBy.measure) : field.col(...sortBy.col), direction: sortBy.dir ?? 'Descending' }],
      isDefaultSort: true,
    };
  }
  const out = visual(page, key, b, v);
  if (filter) out.json.filterConfig = { filters: [filter] };
  return out;
}

function matrix(page, key, region, { title, alt, rows, columns, measure }) {
  const b = region.x !== undefined ? region : box(region);
  const ref = `${IS}.${measure}`;
  const v = {
    visualType: 'pivotTable',
    query: {
      queryState: {
        Rows: { projections: rows.map(([t, c]) => C_(t, c)) },
        Columns: { projections: columns.map(([t, c]) => C_(t, c)) },
        Values: { projections: [M_(IS, measure)] },
      },
    },
    objects: {
      columnHeaders: [props({ autoSizeColumnWidth: lit(true), columnAdjustment: lit('growToFit'), fontFamily: lit(FONT.title), fontSize: D(11), fontColor: col(C.text), backColor: col(C.band) })],
      rowHeaders: [props({ fontFamily: lit(FONT.title), fontSize: D(11), fontColor: col(C.text), backColor: col(C.band) })],
      values: [
        props({ fontFamily: lit(FONT.mono), fontSize: D(10), fontColorPrimary: col(C.text), fontColorSecondary: col(C.text), backColorPrimary: col(C.surface), backColorSecondary: col(C.surface) }),
        props({
          backColor: {
            solid: {
              color: {
                expr: {
                  FillRule: {
                    Input: { SelectRef: { ExpressionName: ref } },
                    FillRule: {
                      linearGradient2: {
                        min: { color: { Literal: { Value: `'${C.surface}'` } } },
                        max: { color: { Literal: { Value: "'#1b6b43'" } } },
                        nullColoringStrategy: { strategy: { Literal: { Value: "'asZero'" } } },
                      },
                    },
                  },
                },
              },
            },
          },
        }, { data: [{ dataViewWildcard: { matchingOption: 1 } }], metadata: ref }),
      ],
      subTotals: [props({ rowSubtotals: lit(false), columnSubtotals: lit(false) })],
    },
    visualContainerObjects: { ...vco({ title, alt }), stylePreset: [props({ name: lit('None') })] },
  };
  return visual(page, key, b, v);
}

function navigator(page, key, region, alt) {
  const b = box(region);
  const sel = (id) => ({ id });
  return visual(page, key, b, {
    visualType: 'pageNavigator',
    objects: {
      layout: [props({ orientation: L(1), cellPadding: D(12) })],
      text: [
        props({ show: lit(true), fontFamily: lit(FONT.title), fontSize: D(18), fontColor: col(C.text), horizontalAlignment: lit('Left'), leftMargin: L(16) }, sel('default')),
        props({ fontColor: col(C.green) }, sel('hover')),
        props({ fontColor: col(C.bg), bold: lit(true) }, sel('selected')),
      ],
      fill: [
        props({ show: lit(true), fillColor: col(C.surface), transparency: D(0) }, sel('default')),
        props({ fillColor: col(C.band) }, sel('hover')),
        props({ fillColor: col(C.green) }, sel('selected')),
      ],
      outline: [props({ show: lit(true), lineColor: col(C.border), weight: D(1) }, sel('default'))],
    },
    visualContainerObjects: {
      background: [props({ show: lit(false) })], border: [props({ show: lit(false) })], visualHeader: [props({ show: lit(false) })],
      padding: [props({ top: D(0), bottom: D(0), left: D(0), right: D(0) })],
      general: [props({ altText: lit(alt) })],
    },
  });
}

// ---------- páginas ----------
const HEADER = [1, 1, 9, 2];
const FILTERS = [9, 1, 13, 2];
const pages = [];
function addPage(id, displayName, build) {
  tab = 0;
  const vs = build(id);
  pages.push({ id, displayName, visuals: vs });
}
const title = (p, t) => textbox(p, 'page_title', HEADER, t, { size: 28, alt: t });

// 0 · Portada
addPage('portada', 'Portada', (p) => [
  title(p, 'Rendimiento DAX 2.0: las demos, en un informe'),
  textbox(p, 'story_text', [1, 2, 7, 13], '', {
    size: 22, font: FONT.body, color: C.text,
    paras: [
      'Cada página repite una demo de la charla con datos reales, con los mismos nombres de bloque que las diapositivas.',
      '',
      'B1 · el mismo importe en moneda local, dólares y euros.',
      'B3 · el año anterior por cuatro caminos (y el 29 de febrero que no cuadra) y las tres fechas de la venta.',
      'B4 · multi-moneda y multi-idioma: eliges en un segmentador y el informe cambia.',
      '',
      'Los bloques de medir, motor y seguridad no tienen página aquí: se hacen en directo con el Puente DAX.',
    ],
    alt: 'Texto de orientación: qué demos hay en el informe y cómo se organizan.',
  }),
  navigator(p, 'page_navigator', [7, 2, 13, 13], 'Navegador de páginas: un botón por demo'),
]);

// 1 · B1 · moneda
addPage('b1-moneda', 'B1 · Moneda', (p) => {
  const meds = ['Sales Amount', 'Total Sales Currency Dolar', 'Total Sales Currency Euro'];
  return [
    title(p, 'B1 · El mismo importe, en local, dólares y euros'),
    slicer(p, 'year_slicer', slot(FILTERS, 0, 2), ['Fecha', 'Year'], 'Año'),
    slicer(p, 'category_slicer', slot(FILTERS, 1, 2), ['Product', 'English Product Category Name'], 'Categoría'),
    card(p, 'card_local', slot([1, 2, 13, 4], 0, 3), 'Sales Amount', 'Moneda local · importe en millones'),
    card(p, 'card_dolares', slot([1, 2, 13, 4], 1, 3), 'Total Sales Currency Dolar', 'Dólares · importe en millones'),
    card(p, 'card_euros', slot([1, 2, 13, 4], 2, 3), 'Total Sales Currency Euro', 'Euros · importe en millones'),
    chart(p, 'importe_por_anio', [1, 4, 7, 9], 'clusteredColumnChart', {
      title: 'Importe por año, en las tres monedas', alt: 'Columnas por año de local, dólares y euros: las tres curvas tienen la misma forma y distinta escala.',
      cat: [['Fecha', 'Year']], measures: meds, sortBy: { col: ['Fecha', 'Year'], dir: 'Ascending' }, legend: true,
    }),
    chart(p, 'importe_por_categoria', [7, 4, 13, 9], 'clusteredBarChart', {
      title: 'Importe por categoría de producto', alt: 'Barras por categoría de producto en local, dólares y euros.',
      cat: [['Product', 'English Product Category Name']], measures: meds, sortBy: { measure: 'Sales Amount' }, legend: true,
    }),
    table(p, 'importe_por_pais', [1, 9, 13, 13], {
      title: 'Importe por país y moneda', alt: 'Tabla por país con el importe local, en dólares y en euros.',
      cols: [['Sales Territory', 'SalesTerritoryCountry', 'País']],
      measures: [['Sales Amount', 'Local'], ['Total Sales Currency Dolar', 'Dólares'], ['Total Sales Currency Euro', 'Euros']],
      sortBy: { measure: 'Sales Amount' },
    }),
  ];
});

// 2 · B3 · año anterior
addPage('b3-aa', 'B3 · Año anterior', (p) => {
  const aa = ['Ventas AA · SPLY', 'Ventas AA · Offset día', 'Ventas AA · Calendario', 'Ventas AA · Columna'];
  const cuadre = ['Cuadre 29-feb · SPLY', 'Cuadre 29-feb · Offset', 'Cuadre 29-feb · Calendario', 'Cuadre 29-feb · Columna'];
  const dayFilter = {
    name: 'Filter' + crypto.createHash('sha1').update('doy').digest('hex').slice(0, 24),
    field: field.col('Fecha', 'Day of Year'),
    type: 'Advanced',
    filter: {
      Version: 2,
      From: [{ Name: 'f', Entity: 'Fecha', Type: 0 }],
      Where: [{ Condition: { Between: { Expression: { Column: { Expression: { SourceRef: { Source: 'f' } }, Property: 'Day of Year' } }, LowerBound: { Literal: { Value: '57L' } }, UpperBound: { Literal: { Value: '62L' } } } } }],
    },
    howCreated: 'User',
  };
  return [
    title(p, 'B3 · Año anterior: tres métodos pierden el 29-feb; la columna lo acumula'),
    slicer(p, 'year_slicer', slot(FILTERS, 0, 1), ['Fecha', 'Year'], 'Año (elige 2013, 2017, 2021 o 2025)'),
    chart(p, 'ventas_vs_aa', [1, 2, 8, 8], 'lineChart', {
      title: 'Ventas y año anterior por mes', alt: 'Líneas por mes: ventas del año y su año anterior con SPLY y con la columna de fecha; a nivel de mes coinciden.',
      cat: [['Fecha', 'Month Name Short']], measures: ['Ventas', 'Ventas AA · SPLY', 'Ventas AA · Columna'], lines: true, legend: true,
    }),
    chart(p, 'cuadre_por_metodo', [8, 2, 13, 8], 'clusteredColumnChart', {
      title: 'Cuadre por mes y método (0 = cuadra)', alt: 'Columnas por mes con la diferencia entre el año anterior del periodo y la suma de sus días: solo febrero se desvía, y la columna cuadra a cero.',
      cat: [['Fecha', 'Month Name Short']], measures: cuadre, legend: true, units: 1,
    }),
    table(p, 'dias_alrededor_del_29', [1, 8, 13, 13], {
      title: 'Los días alrededor del 29 de febrero (día del año 57 a 62)', alt: 'Tabla de seis días con las ventas y el año anterior de cada método.',
      cols: [['Fecha', 'Date', 'Día']],
      measures: [['Ventas', 'Ventas'], ...aa.map((m) => [m, m.replace('Ventas AA · ', 'AA · ')])],
      sortBy: { col: ['Fecha', 'Date'], dir: 'Ascending' }, filter: dayFilter,
    }),
  ];
});

// 3 · B3 · tres fechas
addPage('b3-fechas', 'B3 · Tres fechas', (p) => [
  title(p, 'B3 · Lo que vendo un mes se entrega en ese mes y en el siguiente'),
  slicer(p, 'year_slicer', slot(FILTERS, 0, 1), ['Fecha', 'Year'], 'Año del pedido'),
  matrix(p, 'pedido_por_entrega', [1, 2, 9, 13], {
    title: 'Mes del pedido (filas) por mes de entrega (columnas)', alt: 'Matriz de ventas con el mes del pedido en filas y el mes de entrega en columnas; la diagonal concentra las ventas.',
    rows: [['Fecha', 'Month Name Short']], columns: [['Fecha entrega', 'Month Name Short Complete']], measure: 'Ventas',
  }),
  chart(p, 'ventas_por_mes_de_entrega', [9, 2, 13, 7], 'columnChart', {
    title: 'Ventas por mes de entrega', alt: 'Columnas con las ventas del año elegido según el mes en que se entregan.',
    cat: [['Fecha entrega', 'Month Name Short Complete']], measures: ['Ventas'], sortBy: { col: ['Fecha entrega', 'MonthKey'], dir: 'Ascending' },
  }),
  table(p, 'ventas_por_pais', [9, 7, 13, 13], {
    title: 'Ventas por país', alt: 'Tabla de países ordenados por ventas.',
    cols: [['Sales Territory', 'SalesTerritoryCountry', 'País']], measures: [['Ventas', 'Ventas']], sortBy: { measure: 'Ventas' },
  }),
]);

// 4 · B4 · multi-moneda
addPage('b4-moneda', 'B4 · Multi-moneda', (p) => [
  title(p, 'B4 · Multi-moneda: la misma medida, en la moneda que elijas'),
  slicer(p, 'moneda_slicer', slot(FILTERS, 0, 2), ['Currency  Destination', 'Currency Name Short'], 'Moneda destino'),
  slicer(p, 'year_slicer', slot(FILTERS, 1, 2), ['Fecha', 'Year'], 'Año'),
  chart(p, 'importe_por_anio', [1, 2, 8, 8], 'columnChart', {
    title: 'Importe por año en la moneda elegida', alt: 'Columnas por año con la medida de moneda destino; cambia al elegir dólar o euro.',
    cat: [['Fecha', 'Year']], measures: ['Total Sales Currency v4'], sortBy: { col: ['Fecha', 'Year'], dir: 'Ascending' },
  }),
  chart(p, 'importe_por_pais', [8, 2, 13, 8], 'barChart', {
    title: 'Importe por país', alt: 'Barras por país con la moneda elegida.',
    cat: [['Sales Territory', 'SalesTerritoryCountry']], measures: ['Total Sales Currency v4'], sortBy: { measure: 'Total Sales Currency v4' },
  }),
  table(p, 'importe_por_categoria', [1, 8, 13, 13], {
    title: 'Categoría: moneda local frente a moneda elegida', alt: 'Tabla por categoría con el importe local y el de la moneda elegida.',
    cols: [['Product', 'English Product Category Name', 'Categoría']],
    measures: [['Sales Amount', 'Local'], ['Total Sales Currency v4', 'Moneda elegida']], sortBy: { measure: 'Sales Amount' },
  }),
]);

// 5 · B4 · multi-idioma
addPage('b4-idioma', 'B4 · Multi-idioma', (p) => [
  title(p, 'B4 · Multi-idioma: cambia el idioma y cambian los nombres'),
  slicer(p, 'idioma_slicer', slot(FILTERS, 0, 1), ['Idiomas', 'Name'], 'Idioma', { mode: 'Basic' }),
  chart(p, 'productos_traducidos', [1, 2, 7, 8], 'barChart', {
    title: 'Productos con el nombre del idioma elegido', alt: 'Barras de los productos con más ventas, con el nombre traducido.',
    cat: [['Multi Idioma product', 'Product translation']], measures: ['Sales Amount'], sortBy: { measure: 'Sales Amount' },
  }),
  chart(p, 'promociones_traducidas', [7, 2, 13, 8], 'barChart', {
    title: 'Promociones con el nombre del idioma elegido', alt: 'Barras de promociones con el nombre traducido.',
    cat: [['Multi Idioma Promotion', 'Multi Idioma Promotion']], measures: ['Sales Amount'], sortBy: { measure: 'Sales Amount' },
  }),
  table(p, 'detalle_producto', [1, 8, 13, 13], {
    title: 'Nombre traducido de cada producto y lo que vende', alt: 'Tabla con la clave del producto, su nombre en el idioma elegido y sus ventas.',
    cols: [['Product', 'ProductKey', 'Clave']],
    measures: [['Producto traducido', 'Nombre'], ['Sales Amount', 'Ventas']], sortBy: { measure: 'Sales Amount' },
  }),
]);

// ---------- tema ----------
const themeBase = 'TerminalDAX';
const guid = crypto.randomBytes(4).toString('hex');
const themeFile = `${themeBase}-${guid}.json`;
const solid = (hex) => ({ solid: { color: hex } });
const axisTheme = { show: true, labelColor: solid(C.muted), gridlineColor: solid(C.border), gridlineStyle: 'dotted', showAxisTitle: false };
const chartStyle = (legend) => ({
  '*': {
    labels: [{ show: true, fontSize: 10, color: solid(C.text) }],
    valueAxis: [{ ...axisTheme, fontSize: 10 }],
    categoryAxis: [{ ...axisTheme, fontSize: 11, gridlineShow: false }],
    legend: [{ show: legend, fontSize: 11, labelColor: solid(C.text) }],
    dataPoint: [{ borderShow: false }],
  },
});
const lineStyle = { ...chartStyle(true)['*'] };
delete lineStyle.dataPoint;
const slicerStyle = {
  '*': {
    header: [{ fontFamily: FONT.title, textSize: 10, fontColor: solid(C.muted), background: solid(C.surface), outlineStyle: 0 }],
    items: [{ fontFamily: FONT.body, textSize: 11, fontColor: solid(C.text), background: solid(C.surface), outlineStyle: 0, padding: 2 }],
    date: [{ fontFamily: FONT.body, textSize: 11, fontColor: solid(C.text) }],
  },
};
const theme = {
  name: themeFile,
  dataColors: [C.green, C.blue, C.amber, C.red, C.text, '#b48cff', '#f0e442', C.muted],
  good: C.green, neutral: C.amber, bad: C.red,
  maximum: '#1b6b43', center: C.amber, minimum: C.surface, null: C.muted,
  foreground: C.text, firstLevelElements: C.text, secondLevelElements: C.muted, thirdLevelElements: C.border,
  fourthLevelElements: C.muted, background: C.surface, secondaryBackground: '#12302a', tableAccent: C.green,
  textClasses: {
    callout: { fontSize: 32, fontFace: FONT.mono, color: C.text },
    title: { fontSize: 14, fontFace: FONT.title, color: C.text },
    header: { fontSize: 12, fontFace: FONT.title, color: C.text },
    label: { fontSize: 11, fontFace: FONT.body, color: C.text },
  },
  visualStyles: {
    '*': {
      '*': {
        background: [{ show: true, color: solid(C.surface), transparency: 0 }],
        border: [{ show: true, color: solid(C.border), radius: 8 }],
        dropShadow: [{ show: false }],
        padding: [{ top: 8, bottom: 8, left: 8, right: 8 }],
        title: [{ show: false, fontColor: solid(C.text), fontFamily: FONT.title, fontSize: 14 }],
        visualHeader: [{ show: false }],
      },
    },
    textbox: { '*': { padding: [{ top: 0, bottom: 0, left: 0, right: 0 }], background: [{ show: false }], border: [{ show: false }] } },
    cardVisual: {
      '*': {
        value: [{ bold: true, fontColor: solid(C.text), $id: 'default' }],
        label: [{ show: true, fontColor: solid(C.muted), $id: 'default' }],
        cardCalloutArea: [{ paddingUniform: 0 }],
        title: [{ show: false }],
      },
    },
    tableEx: {
      '*': {
        columnHeaders: [{ autoSizeColumnWidth: true, columnAdjustment: 'growToFit', backColor: solid(C.band), fontColor: solid(C.text), bold: false }],
        values: [{ backColorPrimary: solid(C.surface), backColorSecondary: solid('#0d211a'), fontColorPrimary: solid(C.text), fontColorSecondary: solid(C.text) }],
      },
    },
    pivotTable: {
      '*': {
        columnHeaders: [{ autoSizeColumnWidth: true, columnAdjustment: 'growToFit', backColor: solid(C.band), fontColor: solid(C.text) }],
        rowHeaders: [{ backColor: solid(C.band), fontColor: solid(C.text) }],
        values: [{ backColorPrimary: solid(C.surface), backColorSecondary: solid(C.surface), fontColorPrimary: solid(C.text), fontColorSecondary: solid(C.text) }],
      },
    },
    barChart: chartStyle(false), columnChart: chartStyle(false),
    clusteredBarChart: chartStyle(true), clusteredColumnChart: chartStyle(true),
    lineChart: {
      '*': {
        ...lineStyle,
        lineStyles: [{ strokeWidth: 3, lineChartType: 'linear', showMarker: true, markerSize: 7 }],
        labels: [{ show: false }],
      },
    },
    slicer: slicerStyle,
  },
};

// ---------- escribir ----------
const write = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); };

// limpiar páginas, marcadores y temas anteriores
fs.rmSync(path.join(def, 'pages'), { recursive: true, force: true });
fs.rmSync(path.join(def, 'bookmarks'), { recursive: true, force: true });
const regDir = path.join(dir, 'StaticResources', 'RegisteredResources');
fs.rmSync(regDir, { recursive: true, force: true });

write(path.join(regDir, themeFile), theme);

const report = JSON.parse(fs.readFileSync(path.join(def, 'report.json'), 'utf8'));
report.themeCollection.customTheme = {
  name: themeFile,
  reportVersionAtImport: { ...report.themeCollection.baseTheme.reportVersionAtImport },
  type: 'RegisteredResources',
};
report.resourcePackages = report.resourcePackages.filter((r) => r.name !== 'RegisteredResources');
report.resourcePackages.push({ name: 'RegisteredResources', type: 'RegisteredResources', items: [{ name: themeFile, path: themeFile, type: 'CustomTheme' }] });
write(path.join(def, 'report.json'), report);

const pageIds = pages.map((p) => id20('page/' + p.id));
write(path.join(def, 'pages', 'pages.json'), {
  $schema: SCH + 'pagesMetadata/1.1.0/schema.json',
  pageOrder: pageIds, activePageName: pageIds[0],
});
pages.forEach((p, i) => {
  const pid = pageIds[i];
  write(path.join(def, 'pages', pid, 'page.json'), {
    $schema: PAGE_SCHEMA, name: pid, displayName: p.displayName, displayOption: 'FitToPage', height: CANVAS.h, width: CANVAS.w,
    objects: {
      background: [props({ color: col(C.bg), transparency: D(0) })],
      outspacePane: [props({
        backgroundColor: col(C.surface), foregroundColor: col(C.text), titleSize: D(12), border: lit(true), borderColor: col(C.border),
        checkboxAndApplyColor: col(C.green), inputBoxColor: col(C.bg),
      })],
      filterCard: [
        props({ backgroundColor: col(C.band), foregroundColor: col(C.text), border: lit(false) }, { id: 'Applied' }),
        props({ backgroundColor: col(C.surface), foregroundColor: col(C.text), border: lit(false) }, { id: 'Available' }),
      ],
    },
  });
  for (const v of p.visuals) write(path.join(def, 'pages', pid, 'visuals', v.name, 'visual.json'), v.json);
});
console.log(`Tema ${themeFile}; ${pages.length} páginas; ${pages.reduce((n, p) => n + p.visuals.length, 0)} visuales.`);
