# Report Spec

## Report identity
- Report name: **Rendimiento DAX 2.0 · las demos**
- Semantic model: `PowerBi/PowerBi.SemanticModel` («antes», 49,6 M filas). El PBIP «después» reutiliza el mismo informe: las medidas que usa tienen el mismo nombre en los dos modelos.
- Audience: asistentes al workshop (analistas y desarrolladores de Power BI) y el ponente, que lo proyecta.
- Primary purpose: que cada demo de la charla tenga su página en el informe, en el mismo orden y con los mismos nombres de bloque que la presentación.
- Delivery target: PBIP local. No se publica.

## User decisions and constraints
- Scope: **un informe, una página por demo con visual**, nombradas por bloque (B1, B3, B4). Los bloques sin visual (B2 medir, B5 motor, B6 RLS y UDF) no llevan página.
- Page count: 6 (portada + 5).
- Interactivity: segmentadores en la banda superior; navegación entre páginas desde la portada.
- Design direction: tema oscuro «terminal» de la presentación (`instrucciones.md`, fase D).
- Publishing: ninguno.
- Tooling: `powerbi-report-authoring` (PBIR), Power BI Desktop para recargar y capturar. Sin editar PBIR a mano.
- Model edit permissions: **ninguna medida nueva**. Se usan las existentes (ver «Model requirements»).
- Accessibility: contraste AA mínimo en todos los pares texto/fondo (medidos abajo), texto alternativo en cada visual, sin depender solo del color (etiquetas de datos, leyendas y marcadores/trazos distintos).
- Data caveats: modelo sintético (2011-01 a 2026-10-11). `Date`/`Fecha` termina en 2026-12-31, así que los segmentadores de año incluyen años sin ventas (2026 parcial).

## Narrative
- Core story: la misma pregunta se contesta de varias maneras, y cada manera tiene un coste. El informe enseña el resultado de cada demo con datos.
- Audience promise: ver en una pantalla lo que la diapositiva mide en el motor.
- Key questions answered:
  - ¿Qué pasa con el 29 de febrero según el método de año anterior?
  - ¿Cuándo se entrega lo que se vende cada mes?
  - ¿Cuánto es el mismo importe en local, dólares y euros?
  - ¿Cómo cambia el informe con la moneda y el idioma elegidos?

## Design identity (from `powerbi-report-design` Step 1)
- Tone: **Terminal oscuro** (el de la presentación): fondo casi negro verdoso, texto claro, acentos fosforito, cifras en monoespaciada.
- Signature: **la barra FE/SE**: verde = Storage Engine/base, ámbar = Formula Engine/alternativa, rojo = alerta/pérdida, azul = información; cada medida conserva su color en todo el informe.
- Brownfield delta: no aplica (el informe se rehace desde cero; las páginas anteriores ya se eliminaron).

## Page plan (archetypes from `powerbi-report-design` Step 3)
0. **Portada · Rendimiento DAX 2.0: las demos, en un informe**
   - Archetype: Narrative Story · variant A (texto + navegación). Rationale: no hay datos que comparar; solo orientar.
   - Purpose: explicar el informe y llevar a cada demo.
   - Visuals: texto de contexto y navegador de páginas.
1. **B1 · Un mismo importe en local, dólares y euros**
   - Archetype: Analytical Canvas · variant B. Rationale: tres medidas hermanas que se comparan por año, categoría y país.
   - Fields/measures: `[Sales Amount]`, `[Total Sales Currency Dolar]`, `[Total Sales Currency Euro]`.
   - Slicers: año y categoría de producto.
2. **B3 · El año anterior en cuatro caminos, y el 29 de febrero que no cuadra**
   - Archetype: Analytical Canvas · variant A. Rationale: una comparación entre métodos con detalle día a día.
   - Fields/measures: `[Ventas]`, `[Ventas AA · SPLY | Offset día | Calendario | Columna]`, `[Cuadre 29-feb · SPLY | Offset | Calendario | Columna]`.
   - Slicers: año.
3. **B3 · Tres fechas: lo que vendí y cuándo se entregó**
   - Archetype: Analytical Canvas · variant B. Rationale: un cruce (pedido × entrega) que el role-playing no permite.
   - Fields/measures: `[Ventas]` con `Fecha` y `Fecha entrega`.
   - Slicers: año del pedido.
4. **B4 · Multi-moneda: elige la moneda y el informe cambia**
   - Archetype: Analytical Canvas · variant A.
   - Fields/measures: `[Total Sales Currency v4]` y `[Sales Amount]` con `Currency  Destination`.
   - Slicers: moneda de destino, año.
5. **B4 · Multi-idioma: los nombres cambian con el idioma**
   - Archetype: Analytical Canvas · variant A.
   - Fields/measures: `[Sales Amount]`, `[Producto traducido]`, `Multi Idioma product`, `Multi Idioma Promotion`, `Idiomas[Name]`.
   - Slicers: idioma.
   - **Riesgo:** depende de la mecánica de parámetros de campo de esas tablas ocultas. Se valida en Desktop; si no funciona, esa página se retira y se avisa.

## Design system summary
- Theme name + base palette: **«Terminal DAX»**, adaptado de `assets/base.json` de la skill de diseño, conservando sus salvaguardas por tipo (textbox, tarjeta, tabla, cabeceras ocultas).
  - Fondo de página `#050d0a`; superficie de visual `#0a1a14`; texto `#d6efe3`; texto atenuado `#7fa595`; rejilla y bordes `#17352a`.
- Color semantics (medida → color):
  - Ventas / Local `#d6efe3`.
  - Dólares `#5fd4ff`.
  - Euros `#ffb347`.
  - AA SPLY `#5fd4ff`; AA Offset `#ffb347`; AA Calendario `#ff5c6c`; AA Columna `#3dfc8f`.
  - Acento general y selección `#3dfc8f`.
  - Alerta/pérdida `#ff5c6c`.
- Typography pairing: **Segoe UI Semibold** (títulos) + **Segoe UI** (cuerpo) + **Cascadia Mono** (cifras). Las fuentes de la presentación (*Chakra Petch*, *IBM Plex Sans*, *IBM Plex Mono*) **no están instaladas** en esta máquina; se usan estas de respaldo. Si se instalan, se cambia solo el tema.
- Layout pattern: lienzo 1920 × 1080, margen 32, separación 24, rejilla de 12 × 12 ajustada a 8 px, título a la izquierda y segmentadores a la derecha en la banda superior.
- Accessibility commitments: contraste medido contra el fondo `#050d0a` y la superficie `#0a1a14`:

  | Color | Fondo | Superficie |
  |---|---:|---:|
  | Texto `#d6efe3` | 16,2:1 | 14,8:1 |
  | Atenuado `#7fa595` | 7,2:1 | 6,6:1 |
  | Verde `#3dfc8f` | 14,5:1 | 13,3:1 |
  | Ámbar `#ffb347` | 11,0:1 | 10,1:1 |
  | Rojo `#ff5c6c` | 6,6:1 | 6,0:1 |
  | Azul `#5fd4ff` | 11,6:1 | 10,5:1 |

  Todos cumplen AA (≥ 4,5:1). Además: etiquetas de datos, leyenda y marcadores distintos por serie (no solo color), texto alternativo, orden de tabulación y nombres de campo legibles.

## Model requirements
- Existing measures: `Sales Amount`, `Total Sales Currency Dolar`, `Total Sales Currency Euro`, `Total Sales Currency v4`, `Ventas`, `Ventas AA · SPLY`, `Ventas AA · Offset día`, `Ventas AA · Calendario`, `Ventas AA · Columna`, `Cuadre 29-feb · SPLY`, `Cuadre 29-feb · Offset`, `Cuadre 29-feb · Calendario`, `Cuadre 29-feb · Columna`, `Producto traducido`.
- New measures: ninguna.
- New calculated columns: ninguna.
- Relationship/sort requirements: ya resueltos (`Fecha`, `Fecha envío` y `Fecha entrega` con relación activa; columnas de nombre de mes ordenadas por su número).
- Notes: el informe debe verse igual contra el modelo «antes» y el «después» (mismos nombres de medida; los importes difieren en unos cientos por el redondeo a 2 decimales).

## Canonical design contract

```yaml
Design Brief:
  generated_by: powerbi-report-design
  contract_version: 1
  mode: greenfield
  design_identity:
    tone: "Terminal oscuro de la presentación: fondo casi negro verdoso, texto claro, acentos fosforito y cifras monoespaciadas"
    signature: "Código de color FE/SE: cada medida conserva su color en todo el informe; verde base/columna, ámbar alternativa, rojo alerta, azul información"
  archetype: Analytical
  color_map:
    - measure: "Internet Sales[Sales Amount]"
      color: "#d6efe3"
      tint: "#12302a"
    - measure: "Internet Sales[Ventas]"
      color: "#d6efe3"
      tint: "#12302a"
    - measure: "Internet Sales[Total Sales Currency Dolar]"
      color: "#5fd4ff"
      tint: "#0f2f3b"
    - measure: "Internet Sales[Total Sales Currency Euro]"
      color: "#ffb347"
      tint: "#3a2a12"
    - measure: "Internet Sales[Total Sales Currency v4]"
      color: "#3dfc8f"
      tint: "#0f3a24"
    - measure: "Internet Sales[Ventas AA · SPLY]"
      color: "#5fd4ff"
      tint: "#0f2f3b"
    - measure: "Internet Sales[Ventas AA · Offset día]"
      color: "#ffb347"
      tint: "#3a2a12"
    - measure: "Internet Sales[Ventas AA · Calendario]"
      color: "#ff5c6c"
      tint: "#3d1a1f"
    - measure: "Internet Sales[Ventas AA · Columna]"
      color: "#3dfc8f"
      tint: "#0f3a24"
    - measure: "Internet Sales[Cuadre 29-feb · SPLY]"
      color: "#5fd4ff"
      tint: "#0f2f3b"
    - measure: "Internet Sales[Cuadre 29-feb · Offset]"
      color: "#ffb347"
      tint: "#3a2a12"
    - measure: "Internet Sales[Cuadre 29-feb · Calendario]"
      color: "#ff5c6c"
      tint: "#3d1a1f"
    - measure: "Internet Sales[Cuadre 29-feb · Columna]"
      color: "#3dfc8f"
      tint: "#0f3a24"
  pages:
    - name: "Rendimiento DAX 2.0: las demos, en un informe"
      role: landing
      archetype: Narrative
      layout_variant: A
      variant_rationale: "No hay datos que comparar: solo contexto y navegación a cada demo."
      page_background: "#050d0a"
      layout_summary: "Texto de orientación a la izquierda y navegador de páginas a la derecha."
      layout_contract:
        canvas: { width: 1920, height: 1080, margin: 32, gutter: 24, snap: 8 }
        grid:
          columns: 12
          rows: 12
          regions:
            header: [1, 1, 13, 2]
            story:  [1, 2, 7, 13]
            nav:    [7, 2, 13, 13]
        placements:
          - id: page_title
            region: header
            kind: textbox
            text: "Rendimiento DAX 2.0: las demos, en un informe"
            purpose: "Decir de qué va el informe antes de cualquier visual."
          - id: story_text
            region: story
            kind: textbox
            text: "Cada página repite una demo de la charla con datos reales: B1 el mismo importe en local, dólares y euros; B3 el año anterior y las tres fechas; B4 multi-moneda y multi-idioma. Los bloques de medir, motor y seguridad no tienen visual: se hacen con el Puente DAX."
            purpose: "Explicar qué hay y cómo se organiza (misma numeración que las diapositivas)."
          - id: page_navigator
            region: nav
            kind: pageNavigator
            purpose: "¿A qué demo quiero ir?"
            field_bindings: "páginas del informe"
        space_audit:
          content_cell_count: 132
          placed_cell_count: 132
          empty_cell_pct: 0
          unplaced_regions: []
          largest_region: { name: story, pct_of_content: 50 }
          balance_rationale: "Texto y navegador reparten el contenido a mitades; la portada no tiene datos que compitan por el espacio."
    - name: "B1 · Un mismo importe en local, dólares y euros"
      role: detail
      archetype: Analytical
      layout_variant: B
      variant_rationale: "Tres medidas hermanas que se comparan por año, categoría y país; hay dimensiones de sobra para cruzarlas."
      page_background: "#050d0a"
      layout_summary: "Tres tarjetas arriba, dos gráficos al centro y una tabla por país abajo."
      layout_contract:
        canvas: { width: 1920, height: 1080, margin: 32, gutter: 24, snap: 8 }
        grid:
          columns: 12
          rows: 12
          regions:
            header:  [1, 1, 9, 2]
            filters: [9, 1, 13, 2]
            kpis:    [1, 2, 13, 4]
            years:   [1, 4, 7, 9]
            category: [7, 4, 13, 9]
            detail:  [1, 9, 13, 13]
        placements:
          - id: page_title
            region: header
            kind: textbox
            text: "B1 · El mismo importe, en local, dólares y euros"
            purpose: "Titular de la demo de moneda."
          - id: year_slicer
            region: filters
            kind: slicer
            field_bindings: "Fecha[Year]"
            slicer_type: dropdown
            slot: 1
            of: 2
          - id: category_slicer
            region: filters
            kind: slicer
            field_bindings: "Product[English Product Category Name]"
            slicer_type: dropdown
            slot: 2
            of: 2
          - id: card_local
            region: kpis
            kind: cardVisual
            purpose: "¿Cuánto es el importe en moneda local?"
            field_bindings: "Internet Sales[Sales Amount]"
            color_strategy: measure_match
            slot: 1
            of: 3
          - id: card_dolares
            region: kpis
            kind: cardVisual
            purpose: "¿Y en dólares?"
            field_bindings: "Internet Sales[Total Sales Currency Dolar]"
            color_strategy: measure_match
            slot: 2
            of: 3
          - id: card_euros
            region: kpis
            kind: cardVisual
            purpose: "¿Y en euros?"
            field_bindings: "Internet Sales[Total Sales Currency Euro]"
            color_strategy: measure_match
            slot: 3
            of: 3
          - id: importe_por_anio
            region: years
            kind: clusteredColumnChart
            purpose: "¿Cómo evolucionan los tres importes por año?"
            field_bindings: { Category: "Fecha[Year]", Y: ["Internet Sales[Sales Amount]", "Internet Sales[Total Sales Currency Dolar]", "Internet Sales[Total Sales Currency Euro]"] }
            sort_policy: category_asc
            color_strategy: measure_match
          - id: importe_por_categoria
            region: category
            kind: clusteredBarChart
            purpose: "¿Qué categoría de producto pesa más en cada moneda?"
            field_bindings: { Category: "Product[English Product Category Name]", Y: ["Internet Sales[Sales Amount]", "Internet Sales[Total Sales Currency Dolar]", "Internet Sales[Total Sales Currency Euro]"] }
            sort_policy: value_desc
            color_strategy: measure_match
          - id: importe_por_pais
            region: detail
            kind: tableEx
            purpose: "¿Qué países concentran cada importe y cuánto difieren las monedas?"
            field_bindings: ["Sales Territory[SalesTerritoryCountry]", "Internet Sales[Sales Amount]", "Internet Sales[Total Sales Currency Dolar]", "Internet Sales[Total Sales Currency Euro]"]
            sort_policy: value_desc
        space_audit:
          content_cell_count: 132
          placed_cell_count: 132
          empty_cell_pct: 0
          unplaced_regions: []
          largest_region: { name: detail, pct_of_content: 36 }
          balance_rationale: "Tira de tarjetas de dos filas, dos gráficos equilibrados y una tabla con espacio para siete países; no queda banda vacía."
    - name: "B3 · El año anterior en cuatro caminos, y el 29 de febrero que no cuadra"
      role: detail
      archetype: Analytical
      layout_variant: A
      variant_rationale: "Una comparación entre métodos: tendencia mensual para lo que coincide, cuadre para lo que no y días de febrero como evidencia."
      page_background: "#050d0a"
      layout_summary: "Línea mensual y barras de cuadre arriba; tabla de los días de febrero y marzo abajo."
      layout_contract:
        canvas: { width: 1920, height: 1080, margin: 32, gutter: 24, snap: 8 }
        grid:
          columns: 12
          rows: 12
          regions:
            header:  [1, 1, 9, 2]
            filters: [9, 1, 13, 2]
            trend:   [1, 2, 8, 8]
            cuadre:  [8, 2, 13, 8]
            days:    [1, 8, 13, 13]
        placements:
          - id: page_title
            region: header
            kind: textbox
            text: "B3 · Año anterior: SPLY, offset y calendario pierden el 29-feb; la columna lo acumula"
            purpose: "Titular con el resultado medido de la demo."
          - id: year_slicer
            region: filters
            kind: slicer
            field_bindings: "Fecha[Year]"
            slicer_type: dropdown
            insight_basis: "Elegir un año posterior a un bisiesto (2013, 2017, 2021, 2025) para ver el cuadre."
          - id: ventas_vs_aa
            region: trend
            kind: lineChart
            purpose: "¿Coincide el año anterior de cada método con el real a nivel de mes?"
            field_bindings: { Category: "Fecha[Month Name Short Complete]", Y: ["Internet Sales[Ventas]", "Internet Sales[Ventas AA · SPLY]", "Internet Sales[Ventas AA · Columna]"] }
            sort_policy: natural_order
            color_strategy: measure_match
          - id: cuadre_por_metodo
            region: cuadre
            kind: clusteredBarChart
            purpose: "¿Qué método pierde ventas al bajar de mes a día?"
            field_bindings: { Y: ["Internet Sales[Cuadre 29-feb · SPLY]", "Internet Sales[Cuadre 29-feb · Offset]", "Internet Sales[Cuadre 29-feb · Calendario]", "Internet Sales[Cuadre 29-feb · Columna]"] }
            sort_policy: none
            color_strategy: measure_match
            comparison_basis: "Diferencia entre el AA del periodo y la suma de sus AA día a día; 0 = cuadra."
          - id: dias_alrededor_del_29
            region: days
            kind: tableEx
            purpose: "¿Qué valor da cada método los días alrededor del 29 de febrero?"
            field_bindings: ["Fecha[Date]", "Internet Sales[Ventas]", "Internet Sales[Ventas AA · SPLY]", "Internet Sales[Ventas AA · Offset día]", "Internet Sales[Ventas AA · Calendario]", "Internet Sales[Ventas AA · Columna]"]
            sort_policy: category_asc
            color_strategy: semantic
            insight_basis: "Filtro del visual: día del año entre 57 y 62 (del 26 de febrero al 2 de marzo)."
        space_audit:
          content_cell_count: 132
          placed_cell_count: 132
          empty_cell_pct: 0
          unplaced_regions: []
          largest_region: { name: days, pct_of_content: 45 }
          balance_rationale: "La tabla de días es la evidencia de la demo (seis columnas, seis filas); la línea y las barras comparten el resto."
    - name: "B3 · Tres fechas: lo que vendí y cuándo se entregó"
      role: detail
      archetype: Analytical
      layout_variant: B
      variant_rationale: "El cruce de dos fechas de la misma venta en una matriz, que es lo que una sola tabla de fechas no permite."
      page_background: "#050d0a"
      layout_summary: "Matriz de mes de pedido por mes de entrega, con la distribución de entregas y los países a la derecha."
      layout_contract:
        canvas: { width: 1920, height: 1080, margin: 32, gutter: 24, snap: 8 }
        grid:
          columns: 12
          rows: 12
          regions:
            header:  [1, 1, 9, 2]
            filters: [9, 1, 13, 2]
            matrix:  [1, 2, 9, 13]
            deliveries: [9, 2, 13, 7]
            countries:  [9, 7, 13, 13]
        placements:
          - id: page_title
            region: header
            kind: textbox
            text: "B3 · Lo que vendo un mes se entrega en ese mes y en el siguiente"
            purpose: "Titular con el hallazgo de la demo."
          - id: year_slicer
            region: filters
            kind: slicer
            field_bindings: "Fecha[Year]"
            slicer_type: dropdown
            insight_basis: "El año del pedido; las entregas pueden caer en el siguiente."
          - id: pedido_por_entrega
            region: matrix
            kind: pivotTable
            purpose: "¿En qué mes se entrega lo vendido en cada mes?"
            field_bindings: { Rows: "Fecha[Month Name]", Columns: "Fecha entrega[Month Name Short Complete]", Values: "Internet Sales[Ventas]" }
            sort_policy: natural_order
            color_strategy: gradient
            comparison_basis: "Degradado de la medida Ventas: más oscuro, menos ventas."
          - id: ventas_por_mes_de_entrega
            region: deliveries
            kind: columnChart
            purpose: "¿Cómo se reparten las entregas en el tiempo?"
            field_bindings: { Category: "Fecha entrega[Month Name Short Complete]", Y: "Internet Sales[Ventas]" }
            sort_policy: category_asc
            color_strategy: measure_match
          - id: ventas_por_pais
            region: countries
            kind: tableEx
            purpose: "¿Qué países concentran las ventas del año elegido?"
            field_bindings: ["Sales Territory[SalesTerritoryCountry]", "Internet Sales[Ventas]"]
            sort_policy: value_desc
        space_audit:
          content_cell_count: 132
          placed_cell_count: 132
          empty_cell_pct: 0
          unplaced_regions: []
          largest_region: { name: matrix, pct_of_content: 67 }
          balance_rationale: "La matriz es la respuesta a la pregunta de la página (12 meses de pedido por 13 de entrega) y necesita ese espacio para leerse; las dos tablas de la derecha dan contexto sin competir."
    - name: "B4 · Multi-moneda: elige la moneda y el informe cambia"
      role: detail
      archetype: Analytical
      layout_variant: A
      variant_rationale: "Un segmentador de moneda que reescribe una medida: tendencia, desglose y detalle responden a la misma elección."
      page_background: "#050d0a"
      layout_summary: "Columnas por año y barras por país arriba; tabla por categoría abajo."
      layout_contract:
        canvas: { width: 1920, height: 1080, margin: 32, gutter: 24, snap: 8 }
        grid:
          columns: 12
          rows: 12
          regions:
            header:  [1, 1, 9, 2]
            filters: [9, 1, 13, 2]
            years:   [1, 2, 8, 8]
            countries: [8, 2, 13, 8]
            detail:  [1, 8, 13, 13]
        placements:
          - id: page_title
            region: header
            kind: textbox
            text: "B4 · Multi-moneda: la misma medida, en la moneda que elijas"
            purpose: "Titular de la demo de moneda destino."
          - id: moneda_slicer
            region: filters
            kind: slicer
            field_bindings: "Currency  Destination[Currency Name Short]"
            slicer_type: dropdown
            slot: 1
            of: 2
          - id: year_slicer
            region: filters
            kind: slicer
            field_bindings: "Fecha[Year]"
            slicer_type: dropdown
            slot: 2
            of: 2
          - id: importe_por_anio
            region: years
            kind: columnChart
            purpose: "¿Cómo evoluciona el importe en la moneda elegida?"
            field_bindings: { Category: "Fecha[Year]", Y: "Internet Sales[Total Sales Currency v4]" }
            sort_policy: category_asc
            color_strategy: measure_match
          - id: importe_por_pais
            region: countries
            kind: barChart
            purpose: "¿Qué países pesan más en esa moneda?"
            field_bindings: { Category: "Sales Territory[SalesTerritoryCountry]", Y: "Internet Sales[Total Sales Currency v4]" }
            sort_policy: value_desc
            color_strategy: measure_match
          - id: importe_por_categoria
            region: detail
            kind: tableEx
            purpose: "¿Cuánto cambia cada categoría entre la moneda elegida y la local?"
            field_bindings: ["Product[English Product Category Name]", "Internet Sales[Sales Amount]", "Internet Sales[Total Sales Currency v4]"]
            sort_policy: value_desc
            color_strategy: measure_match
        space_audit:
          content_cell_count: 132
          placed_cell_count: 132
          empty_cell_pct: 0
          unplaced_regions: []
          largest_region: { name: detail, pct_of_content: 45 }
          balance_rationale: "Una tendencia, un reparto y un detalle comparativo; el detalle es la tabla con la medida local al lado para ver el efecto de la moneda."
    - name: "B4 · Multi-idioma: los nombres cambian con el idioma"
      role: detail
      archetype: Analytical
      layout_variant: A
      variant_rationale: "Un segmentador de idioma que cambia las etiquetas de varias dimensiones a la vez."
      page_background: "#050d0a"
      layout_summary: "Ranking de productos y de promociones con nombre traducido arriba; tabla con el detalle abajo."
      layout_contract:
        canvas: { width: 1920, height: 1080, margin: 32, gutter: 24, snap: 8 }
        grid:
          columns: 12
          rows: 12
          regions:
            header:  [1, 1, 9, 2]
            filters: [9, 1, 13, 2]
            products: [1, 2, 7, 8]
            promotions: [7, 2, 13, 8]
            detail:  [1, 8, 13, 13]
        placements:
          - id: page_title
            region: header
            kind: textbox
            text: "B4 · Multi-idioma: cambia el idioma y cambian los nombres"
            purpose: "Titular de la demo de idioma."
          - id: idioma_slicer
            region: filters
            kind: slicer
            field_bindings: "Idiomas[Name]"
            slicer_type: list
            insight_basis: "Tres idiomas: la lista corta cabe en la banda y se ve cuál está activo."
          - id: productos_traducidos
            region: products
            kind: barChart
            purpose: "¿Qué productos venden más, con su nombre en el idioma elegido?"
            field_bindings: { Category: "Multi Idioma product[Product translation]", Y: "Internet Sales[Sales Amount]" }
            sort_policy: value_desc
            color_strategy: measure_match
          - id: promociones_traducidas
            region: promotions
            kind: barChart
            purpose: "¿Y las promociones?"
            field_bindings: { Category: "Multi Idioma Promotion[Multi Idioma Promotion]", Y: "Internet Sales[Sales Amount]" }
            sort_policy: value_desc
            color_strategy: measure_match
          - id: detalle_producto
            region: detail
            kind: tableEx
            purpose: "¿Qué nombre muestra cada producto en cada idioma, y cuánto vende?"
            field_bindings: ["Product[ProductKey]", "Internet Sales[Producto traducido]", "Internet Sales[Sales Amount]"]
            sort_policy: value_desc
        space_audit:
          content_cell_count: 132
          placed_cell_count: 132
          empty_cell_pct: 0
          unplaced_regions: []
          largest_region: { name: detail, pct_of_content: 45 }
          balance_rationale: "Dos rankings equilibrados y una tabla que enseña la medida de nombre traducido; sin banda vacía."
  interaction_pattern:
    drill_targets: []
    cross_filter_rules: "Filtro entre visuales de la misma página; los segmentadores no se sincronizan entre páginas."
  accessibility:
    alt_text_strategy: "chart+structure: título, qué compara y la conclusión de la demo"
    contrast_notes: "Todos los pares texto/fondo y serie/fondo superan 4,5:1 (mínimo 6,0:1, el rojo sobre la superficie). Las series se distinguen también por marcador, trazo y etiqueta de datos."
  theme:
    base: "assets/base.json adaptado a «Terminal DAX» (fondo #050d0a, superficie #0a1a14, Segoe UI / Cascadia Mono)"
    user_overrides: "Las fuentes de la presentación no están instaladas: se usan Segoe UI y Cascadia Mono."
```

## Implementation notes
- Model changes: ninguno. Se usan las medidas existentes.
- PBIR/report authoring: `powerbi-report-authoring` (herramienta `powerbi-report-author`), sin editar los ficheros a mano. Tema «Terminal DAX» registrado en el informe.
- Validation: validar el PBIR; recargar en Desktop; capturar cada página en `pruebas/capturas/` (≤ 1 MB cada una); revisar desbordes, solapes, etiquetas cortadas y contraste.
- Desktop screenshot verification: sí, página por página.
- Publishing boundary: ninguno. Todo local.
- Risks:
  - Las fuentes de la presentación no están instaladas.
  - La página de multi-idioma depende de la mecánica de parámetros de campo de las tablas ocultas `Multi Idioma …`.
  - `Fecha[Date]` llega a diciembre de 2026 pero las ventas, a octubre; el año 2026 sale parcial.
  - Las medidas `Total Sales Currency Dolar/Euro` se calculan distinto en «antes» y «después» (columna frente a `SUMX`); los importes coinciden salvo por redondeo.
  - Hay que tener el Desktop del «antes» abierto para recargar y capturar.
