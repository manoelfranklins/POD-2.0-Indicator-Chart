# 📊 Indicator Chart — SAP Digital Manufacturing POD 2.0 Widget

A live, auto-updating line chart widget for SAP Digital Manufacturing POD 2.0. Polls any Production Process on a configurable interval, plots the numeric output value in real time, and reacts visually to configurable thresholds.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![SAP DM](https://img.shields.io/badge/SAP%20Digital%20Manufacturing-POD%202.0-0070F2)
![No dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)

---

## ✨ Features

- **Live line chart** — smooth Bézier curves, gradient fill, rolling 20-point window
- **Configurable poll interval** — default 10 s, minimum 3 s, restarts instantly when changed in POD Designer
- **Threshold alerting** — set low/high bounds with independent hex colors per zone
- **Full visual reaction** — KPI number, data point dots, callout bubble, and card border all change color by threshold zone
- **Per-point coloring** — each historical dot is colored by the zone it fell in at collection time
- **Hover tooltip** — move over any dot to see its value + timestamp in a styled bubble
- **Blinking LIVE badge** — animated CSS pulse so operators know data is fresh
- **Side-by-side layout** — set `Width = 50%` on two instances for a dashboard row
- **Context-aware** — SFC, operation, work center, and resource passed automatically from POD state
- **Zero dependencies** — pure Canvas 2D API, no npm, no third-party libraries
- **i18n** — English, German, Chinese Simplified, Japanese

---

## 📸 Screenshots

> *Two instances side by side — Temperature trending down (red, below threshold) and Moisture rising (green, within range)*

<img width="1430" height="491" alt="image" src="https://github.com/user-attachments/assets/cfa74660-1583-4b6d-9785-0952e0de5dd3" />

---

## 🚀 Installation

1. Download `IndicatorChart_deployment.zip` 
2. Navigate to **Manage PODs 2.0** app
3. Go to **Extensions** tab
4. Click **Create**
5. Fill in:
   - **Name**: Indicator Chart (or your preferred name)
   - **Namespace**: `custom/pod2/indicatorchart`
   - **Source Code**: Browse and Select the ZIP file
6. Click **Upload**
7. The widget appears immediately in Manage PODs 2.0 under **Custom Widgets** on a POD edit mode
4. Drag **Indicator Chart** onto your POD canvas and configure the properties below

> ⚠️ The ZIP must contain `extension.json` at its root. The release ZIP is pre-packaged correctly — don't re-zip.

---

## ⚙️ Configuration

All properties are set in Manage PODs 2.0's property panel. Changes take effect without a page reload.

<img width="325" height="696" alt="image" src="https://github.com/user-attachments/assets/c5e57868-d7e1-4548-9b89-2a2ba8c993d0" />

### General

| Property | Default | Description |
|---|---|---|
| **Process Key** | `REG_f896e516-…` | Key of the SAP DM Production Process to poll. Copy from Manage Production Processes. Format: `REG_<UUID>` |
| **Chart Title** | `Process Output` | Title shown in the top-left of the widget card |
| **Width** | `100%` | CSS width — use `50%` for two side-by-side instances, `33%` for three |
| **Update Interval (seconds)** | `10` | Poll frequency in seconds. Minimum `3`. Restarts immediately on change |

### Threshold & Color

| Property | Default | Description |
|---|---|---|
| **Low Threshold** | *(empty)* | Values **below** this trigger the Below Low color. Leave empty to disable |
| **High Threshold** | *(empty)* | Values **above** this trigger the Above High color. Leave empty to disable |
| **Color — Below Low** | `#BB0000` | Hex color for the below-minimum state (red) |
| **Color — Normal** | `#188918` | Hex color for the in-range state (green) |
| **Color — Above High** | `#E9730C` | Hex color for the above-maximum state (amber) |

### What Reacts to the Threshold Color

| Element | Reacts? |
|---|---|
| Current Value (KPI number) | ✅ |
| Status dot | ✅ |
| Card left-border accent stripe | ✅ |
| Data point dots (per-point) | ✅ |
| Latest value callout bubble | ✅ |
| Hover tooltip bar & value | ✅ |
| Chart line stroke | ❌ Always dark (`#32363A`) |
| Chart gradient fill | ❌ Always dark at 12% opacity |

---

## 🔌 Production Process Setup

The widget calls:

```
POST dmi/pe/api/v1/process/processDefinitions/start?key=<processKey>&async=false
```

With the following body (fields omitted when not available in context):

```json
{
  "inPlant":      "PLANT_001",
  "inSfc":        "SFC_12345",
  "inOperation":  "OP_10",
  "inWorkCenter": "WC_001",
  "inResource":   "RESOURCE_001"
}
```

The widget extracts the numeric output value in this priority order:

1. Direct `output` field at response root
2. Nested `output.output`
3. First item in `aq` (uncollected parameters) array → `value` or `defaultValue`
4. `aq` as a single object → `value` or `defaultValue`
5. First numeric-looking field at response root (fallback)

> Your process needs to return a numeric value in any of these locations for the chart to update.
> Non-numeric values are displayed in the KPI label but don't add a data point to the chart.

---

## 📁 File Structure

```
20indicatorChart/
├── extension.json              # Widget registration
├── widget/
│   └── IndicatorChart.js       # All widget logic — chart, thresholds, hover, interval
├── i18n/
│   ├── i18n.properties         # Default / English fallback
│   ├── i18n_en.properties
│   ├── i18n_de.properties
│   └── i18n_zh.properties
│   └── i18n_ja.properties
└── IndicatorChart_deployment.zip
```
---

## 🌍 i18n

| File | Language |
|---|---|
| `i18n.properties` | Default fallback (English) |
| `i18n_en.properties` | English |
| `i18n_de.properties` | German |
| `i18n_zh.properties` | Chinese Simplified |
| `i18n_ja.properties` | Japanese |

To add a language: copy `i18n_en.properties` → `i18n_<ISO-639-1>.properties`, translate values, re-package.

---

## 🐛 Troubleshooting

| Symptom | Fix |
|---|---|
| Chart stuck on "Waiting for data..." | Check the Process Key. Open browser console and look for a 4xx error on the process endpoint. Verify the process is active (not draft). |
| "Non-numeric value received" | Your process output isn't a number. Check the output parameter type in your process definition. |
| Current Value stays blue | Threshold values must be plain numbers (`80`, not `80°C`). Colors must be valid hex (`#BB0000`). |
| Hover tooltip not showing | Needs ≥ 2 data points. Mouse must be within ~16 px of a dot. |
| Interval not updating | Enter a plain integer (`5`, not `5s`). Values below `3` are clamped to `3`. Save the POD after editing. |
| Upload fails | Confirm `extension.json` is at ZIP root, not inside a subfolder. |

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 👨‍💻 Author

Manoel Costa http://manoelcosta.com/

Disclaimer: This is a community extension and is not officially supported by SAP. Use at your own discretion.
