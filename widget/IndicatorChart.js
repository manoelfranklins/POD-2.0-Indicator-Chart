sap.ui.define([
    "sap/m/VBox",
    "sap/m/HBox",
    "sap/m/Text",
    "sap/m/Title",
    "sap/ui/core/HTML",
    "sap/ui/model/json/JSONModel",
    "sap/dm/dme/pod2/widget/Widget",
    "sap/dm/dme/pod2/widget/metadata/WidgetProperty",
    "sap/dm/dme/pod2/propertyeditor/StringPropertyEditor",
    "sap/dm/dme/pod2/propertyeditor/PropertyCategory",
    "sap/dm/dme/pod2/context/PodContext",
    "sap/dm/dme/pod2/model/I18nResourceModel",
    "sap/dm/dme/pod2/api/RestClient"
], function (
    VBox,
    HBox,
    Text,
    Title,
    HTML,
    JSONModel,
    Widget,
    WidgetProperty,
    StringPropertyEditor,
    PropertyCategory,
    PodContext,
    I18nResourceModel,
    RestClient
) {
    "use strict";

    var MAX_DATA_POINTS   = 20;
    var ACCENT_COLOR      = "#0070F2";
    var GRID_COLOR        = "rgba(200, 200, 200, 0.3)";
    var CHART_ID_PREFIX   = "indicatorChart_canvas_";
    var DEFAULT_COLOR_BELOW  = "#BB0000";
    var DEFAULT_COLOR_NORMAL = "#188918";
    var DEFAULT_COLOR_ABOVE  = "#E9730C";
    var LINE_COLOR = "#32363A"; // chart line + gradient — always dark, independent of thresholds
    var MIN_INTERVAL_SEC  = 3;

    class IndicatorChart extends Widget {

        // ---- private fields ----
        #oStatusModel;
        #oRootVBox;
        #oCurrentValueText;
        #oStatusDot;
        #oChartHtml;
        #nIntervalId;
        #aDataPoints       = [];
        #sCanvasId;
        #bFirstLoad        = true;
        // hover / snapshot
        #aHitAreas         = [];
        #oCanvasSnapshot   = null;
        #oMouseMoveHandler = null;
        #oMouseLeaveHandler = null;
        #oCurrentCanvasEl  = null;

        // ---- static i18n ----
        static #oI18nModel = null;

        static getI18nModel() {
            if (!IndicatorChart.#oI18nModel) {
                IndicatorChart.#oI18nModel = new I18nResourceModel({
                    bundleName: "custom.pod2.indicatorchart.i18n.i18n"
                });
            }
            return IndicatorChart.#oI18nModel;
        }

        // ---- metadata ----
        static getDisplayName() { return "Indicator Chart"; }
        static getDescription() { return "Polls a production process on a configurable interval and plots output as a live line chart with threshold alerting."; }
        static getIcon()        { return "sap-icon://line-chart"; }
        static getCategory()    { return "Custom Widgets"; }

        static getDefaultConfig() {
            return {
                properties: {
                    processKey:      "REG_f896e516-3240-4612-b0b4-fc7bb362244e",
                    chartTitle:      "Process Output",
                    widgetWidth:     "100%",
                    updateInterval:  "10",
                    thresholdLow:    "",
                    thresholdHigh:   "",
                    colorBelowLow:   DEFAULT_COLOR_BELOW,
                    colorNormal:     DEFAULT_COLOR_NORMAL,
                    colorAboveHigh:  DEFAULT_COLOR_ABOVE
                }
            };
        }

        // ---- view construction (called BEFORE onInit) ----
        _createView() {
            const oConfig = this.getConfig();
            if (!oConfig || !oConfig.id) {
                return new VBox({ items: [new Text({ text: "Configuration error" })] });
            }

            this.#sCanvasId = CHART_ID_PREFIX + oConfig.id.replace(/[^a-zA-Z0-9]/g, "_");

            // Model initialised HERE — _createView runs before onInit
            this.#oStatusModel = new JSONModel({
                statusText:     this.getI18nText("status.loading"),
                currentValue:   "—",
                dataPointCount: 0,
                lastUpdated:    "—",
                hasError:       false,
                errorText:      "",
                chartTitle:     this.getPropertyValue("chartTitle") || "Process Output"
            });

            // Header: title + blinking LIVE badge
            const oTitle = new Title({ level: "H4" });
            oTitle.bindProperty("text", { path: "status>/chartTitle" });
            oTitle.addStyleClass("indicatorChartTitle");

            const oLiveBadge = new Text({ text: this.getI18nText("badge.live") });
            oLiveBadge.addStyleClass("indicatorLiveBadge");

            const oHeader = new HBox({
                justifyContent: "SpaceBetween",
                alignItems:     "Center",
                items: [oTitle, oLiveBadge]
            }).addStyleClass("indicatorChartHeader");

            // KPI row
            const oCurrentValueLabel = new Text({ text: this.getI18nText("label.currentValue") });
            oCurrentValueLabel.addStyleClass("indicatorKpiLabel");

            this.#oCurrentValueText = new Text();
            this.#oCurrentValueText.bindProperty("text", { path: "status>/currentValue" });
            this.#oCurrentValueText.addStyleClass("indicatorKpiValue");

            const oPointsLabel = new Text({ text: this.getI18nText("label.dataPoints") });
            oPointsLabel.addStyleClass("indicatorKpiLabel");
            const oPointsText = new Text();
            oPointsText.bindProperty("text", { path: "status>/dataPointCount" });
            oPointsText.addStyleClass("indicatorKpiSmall");

            const oUpdatedLabel = new Text({ text: this.getI18nText("label.lastUpdated") });
            oUpdatedLabel.addStyleClass("indicatorKpiLabel");
            const oUpdatedText = new Text();
            oUpdatedText.bindProperty("text", { path: "status>/lastUpdated" });
            oUpdatedText.addStyleClass("indicatorKpiSmall");

            const oKpiRow = new HBox({
                alignItems: "Center",
                wrap:       "Wrap",
                items: [
                    new VBox({ items: [oCurrentValueLabel, this.#oCurrentValueText] }).addStyleClass("indicatorKpiBlock"),
                    new VBox({ items: [oPointsLabel,       oPointsText]             }).addStyleClass("indicatorKpiBlock"),
                    new VBox({ items: [oUpdatedLabel,      oUpdatedText]            }).addStyleClass("indicatorKpiBlock")
                ]
            }).addStyleClass("indicatorKpiRow");

            // Canvas
            this.#oChartHtml = new HTML({
                content: "<canvas id=\"" + this.#sCanvasId + "\" "
                    + "style=\"width:100%;height:200px;display:block;\" "
                    + "aria-label=\"Process output line chart\"></canvas>",
                afterRendering: this._onChartRendered.bind(this)
            });

            // Error strip
            const oErrorText = new Text();
            oErrorText.bindProperty("text",    { path: "status>/errorText" });
            oErrorText.bindProperty("visible", { path: "status>/hasError"  });
            oErrorText.addStyleClass("indicatorErrorText");

            // Status bar
            this.#oStatusDot = new Text({ text: "●" });
            this.#oStatusDot.addStyleClass("indicatorStatusDot");
            const oStatusText = new Text();
            oStatusText.bindProperty("text", { path: "status>/statusText" });
            oStatusText.addStyleClass("indicatorStatusText");

            const oStatusBar = new HBox({
                alignItems: "Center",
                items: [this.#oStatusDot, oStatusText]
            }).addStyleClass("indicatorStatusBar");

            // Root — ID MUST be exactly oConfig.id (no suffix)
            const oRoot = new VBox(oConfig.id, {
                items: [oHeader, oKpiRow, this.#oChartHtml, oErrorText, oStatusBar],
                width: this.getPropertyValue("widgetWidth") || "100%"
            }).addStyleClass("indicatorChartRoot");

            this.#oRootVBox = oRoot;
            oRoot.setModel(this.#oStatusModel, "status");
            this.#injectStyles();

            return oRoot;
        }

        // ---- lifecycle ----
        async onInit() {
            await super.onInit();

            if (PodContext.isRunMode()) {
                await this._fetchAndPlot();

                if (this.#nIntervalId === undefined) {
                    this.#nIntervalId = setInterval(() => {
                        this._fetchAndPlot().catch(e => console.error("IndicatorChart: interval error", e));
                    }, this.#getIntervalMs());
                }
            }
        }

        onExit() {
            if (this.#nIntervalId !== undefined) {
                clearInterval(this.#nIntervalId);
                this.#nIntervalId = undefined;
            }
            this.#detachMouseHandlers();
            PodContext.unsubscribeAll(this);
            this.#oStatusModel       = null;
            this.#oRootVBox          = null;
            this.#oCurrentValueText  = null;
            this.#oStatusDot         = null;
            this.#oChartHtml         = null;
            this.#aDataPoints        = [];
            this.#aHitAreas          = [];
            this.#oCanvasSnapshot    = null;
            super.onExit();
        }

        // ---- property definitions ----
        getProperties() {
            return [
                new WidgetProperty({
                    displayName: this.getI18nText("property.processKey"),
                    description: this.getI18nText("property.processKey.desc"),
                    category: PropertyCategory.Main,
                    propertyEditor: new StringPropertyEditor(this, "processKey")
                }),
                new WidgetProperty({
                    displayName: this.getI18nText("property.chartTitle"),
                    description: this.getI18nText("property.chartTitle.desc"),
                    category: PropertyCategory.Main,
                    propertyEditor: new StringPropertyEditor(this, "chartTitle")
                }),
                new WidgetProperty({
                    displayName: this.getI18nText("property.widgetWidth"),
                    description: this.getI18nText("property.widgetWidth.desc"),
                    category: PropertyCategory.Main,
                    propertyEditor: new StringPropertyEditor(this, "widgetWidth")
                }),
                new WidgetProperty({
                    displayName: this.getI18nText("property.updateInterval"),
                    description: this.getI18nText("property.updateInterval.desc"),
                    category: PropertyCategory.Main,
                    propertyEditor: new StringPropertyEditor(this, "updateInterval")
                }),
                new WidgetProperty({
                    displayName: this.getI18nText("property.thresholdLow"),
                    description: this.getI18nText("property.thresholdLow.desc"),
                    category: PropertyCategory.Main,
                    propertyEditor: new StringPropertyEditor(this, "thresholdLow")
                }),
                new WidgetProperty({
                    displayName: this.getI18nText("property.thresholdHigh"),
                    description: this.getI18nText("property.thresholdHigh.desc"),
                    category: PropertyCategory.Main,
                    propertyEditor: new StringPropertyEditor(this, "thresholdHigh")
                }),
                new WidgetProperty({
                    displayName: this.getI18nText("property.colorBelowLow"),
                    description: this.getI18nText("property.colorBelowLow.desc"),
                    category: PropertyCategory.Main,
                    propertyEditor: new StringPropertyEditor(this, "colorBelowLow")
                }),
                new WidgetProperty({
                    displayName: this.getI18nText("property.colorNormal"),
                    description: this.getI18nText("property.colorNormal.desc"),
                    category: PropertyCategory.Main,
                    propertyEditor: new StringPropertyEditor(this, "colorNormal")
                }),
                new WidgetProperty({
                    displayName: this.getI18nText("property.colorAboveHigh"),
                    description: this.getI18nText("property.colorAboveHigh.desc"),
                    category: PropertyCategory.Main,
                    propertyEditor: new StringPropertyEditor(this, "colorAboveHigh")
                })
            ];
        }

        getPropertyValue(sName) {
            const vValue = super.getPropertyValue(sName);
            if (sName === "processKey")      return vValue || "REG_f896e516-3240-4612-b0b4-fc7bb362244e";
            if (sName === "chartTitle")      return vValue || "Process Output";
            if (sName === "widgetWidth")     return vValue || "100%";
            if (sName === "updateInterval")  return vValue || "10";
            if (sName === "thresholdLow")    return vValue || "";
            if (sName === "thresholdHigh")   return vValue || "";
            if (sName === "colorBelowLow")   return vValue || DEFAULT_COLOR_BELOW;
            if (sName === "colorNormal")     return vValue || DEFAULT_COLOR_NORMAL;
            if (sName === "colorAboveHigh")  return vValue || DEFAULT_COLOR_ABOVE;
            return vValue;
        }

        setPropertyValue(sName, vValue) {
            super.setPropertyValue(sName, vValue);

            if (sName === "chartTitle" && this.#oStatusModel) {
                this.#oStatusModel.setProperty("/chartTitle", vValue);
            }
            if (sName === "widgetWidth" && this.#oRootVBox) {
                this.#oRootVBox.setWidth(vValue || "100%");
            }
            if (sName === "updateInterval") {
                this.#restartInterval();
            }
            if (["thresholdLow", "thresholdHigh",
                 "colorBelowLow", "colorNormal", "colorAboveHigh"].includes(sName)) {
                if (this.#aDataPoints.length > 0) this.#renderChart();
            }
        }

        // ---- chart callback (fires after every HTML control re-render) ----
        _onChartRendered() {
            this.#setupMouseHandlers();
            this.#renderChart();
        }

        // ---- data fetching ----
        async _fetchAndPlot() {
            const sProcessKey = this.getPropertyValue("processKey");
            if (!sProcessKey) return;

            this.#setStatus(this.getI18nText("status.fetching"), false);

            try {
                const oBody = this.#buildRequestBody();
                const sUrl  = "dmi/pe/api/v1/process/processDefinitions/start?key="
                    + encodeURIComponent(sProcessKey) + "&async=false";

                const oResponse = await RestClient.post(sUrl, oBody);
                const vOutput   = this.#extractOutput(oResponse);
                const nNumeric  = parseFloat(vOutput);

                if (!isNaN(nNumeric)) {
                    const now   = new Date();
                    const sTime = now.getHours().toString().padStart(2, "0") + ":"
                        + now.getMinutes().toString().padStart(2, "0") + ":"
                        + now.getSeconds().toString().padStart(2, "0");

                    this.#aDataPoints.push({ value: nNumeric, time: sTime });
                    if (this.#aDataPoints.length > MAX_DATA_POINTS) this.#aDataPoints.shift();

                    this.#oStatusModel.setProperty("/currentValue",   nNumeric.toFixed(2));
                    this.#oStatusModel.setProperty("/dataPointCount", this.#aDataPoints.length);
                    this.#oStatusModel.setProperty("/lastUpdated",    sTime);
                    this.#setStatus(
                        this.getI18nText("status.live", [this.#getIntervalMs() / 1000]),
                        false
                    );
                    this.#renderChart();
                    this.#bFirstLoad = false;

                } else {
                    const sDisplay = String(vOutput != null ? vOutput : this.getI18nText("label.noOutput"));
                    this.#oStatusModel.setProperty("/currentValue", sDisplay);
                    this.#setStatus(this.getI18nText("status.nonNumeric"), false);
                }

            } catch (oError) {
                const sMsg = oError && oError.message ? oError.message : this.getI18nText("error.unknown");
                this.#setStatus(this.getI18nText("status.error"), true, sMsg);
                if (this.#bFirstLoad) this.#renderChart();
            }
        }

        // ---- private helpers ----

        #getIntervalMs() {
            const nSec = parseInt(this.getPropertyValue("updateInterval"), 10);
            return Math.max(MIN_INTERVAL_SEC, isNaN(nSec) ? 10 : nSec) * 1000;
        }

        #restartInterval() {
            if (!PodContext.isRunMode()) return;
            if (this.#nIntervalId !== undefined) {
                clearInterval(this.#nIntervalId);
                this.#nIntervalId = undefined;
            }
            this.#nIntervalId = setInterval(() => {
                this._fetchAndPlot().catch(e => console.error("IndicatorChart: interval error", e));
            }, this.#getIntervalMs());
        }

        #buildRequestBody() {
            const oBody = {};
            try {
                const sPlant = PodContext.getPlant();
                if (sPlant) oBody.inPlant = sPlant;

                const oOp = PodContext.getLastSelectedOperationActivity();
                const oWL = PodContext.getLastSelectedWorkListItem();

                if (oOp && oWL) {
                    oBody.inSfc        = oWL.sfc;
                    oBody.inOperation  = oOp.operationActivity;
                    oBody.inWorkCenter = oOp.workCenter;
                } else if (oWL) {
                    oBody.inSfc        = oWL.sfc;
                    oBody.inOperation  = oWL.operationActivity;
                    oBody.inWorkCenter = oWL.workCenter;
                } else {
                    const aItems = PodContext.getSelectedWorkListItems();
                    if (Array.isArray(aItems) && aItems.length > 0) {
                        oBody.inSfc       = aItems[0].sfc;
                        oBody.inOperation = aItems[0].operationActivity;
                    }
                }

                const aRes = PodContext.getFilterResources();
                if (Array.isArray(aRes) && aRes.length > 0 && aRes[0].resource) {
                    oBody.inResource = aRes[0].resource;
                }
            } catch (e) { /* design mode — no context */ }
            return oBody;
        }

        #extractOutput(oResponse) {
            if (!oResponse) return null;
            if (oResponse.output !== undefined && oResponse.output !== null
                    && typeof oResponse.output !== "object") return oResponse.output;
            if (oResponse.output && typeof oResponse.output === "object"
                    && oResponse.output.output !== undefined) return oResponse.output.output;
            if (Array.isArray(oResponse.aq) && oResponse.aq.length > 0) {
                const o = oResponse.aq[0];
                return o.value !== undefined ? o.value : o.defaultValue;
            }
            if (oResponse.aq && typeof oResponse.aq === "object") {
                return oResponse.aq.value !== undefined ? oResponse.aq.value : oResponse.aq.defaultValue;
            }
            for (const sKey of Object.keys(oResponse)) {
                const v = oResponse[sKey];
                if (typeof v === "number") return v;
                if (typeof v === "string" && v.length > 0 && !isNaN(parseFloat(v))) return v;
            }
            return null;
        }

        #setStatus(sText, bError, sErrorText) {
            if (!this.#oStatusModel) return;
            this.#oStatusModel.setProperty("/statusText", sText);
            this.#oStatusModel.setProperty("/hasError",   !!bError);
            this.#oStatusModel.setProperty("/errorText",  sErrorText || "");
        }

        // ---- threshold helpers ----

        #getActiveColor(nValue) {
            const nLow  = parseFloat(this.getPropertyValue("thresholdLow"));
            const nHigh = parseFloat(this.getPropertyValue("thresholdHigh"));
            const bHasLow  = !isNaN(nLow);
            const bHasHigh = !isNaN(nHigh);
            if (!bHasLow && !bHasHigh) return ACCENT_COLOR;
            if (bHasHigh && nValue > nHigh) return this.getPropertyValue("colorAboveHigh") || DEFAULT_COLOR_ABOVE;
            if (bHasLow  && nValue < nLow)  return this.getPropertyValue("colorBelowLow")  || DEFAULT_COLOR_BELOW;
            return this.getPropertyValue("colorNormal") || DEFAULT_COLOR_NORMAL;
        }

        #hexToRgba(sHex, fAlpha) {
            const s = (sHex || "#0070F2").replace("#", "");
            const r = parseInt(s.substring(0, 2), 16) || 0;
            const g = parseInt(s.substring(2, 4), 16) || 0;
            const b = parseInt(s.substring(4, 6), 16) || 0;
            return "rgba(" + r + "," + g + "," + b + "," + fAlpha + ")";
        }

        // Push active color as a CSS custom property on the root element.
        // Using a custom property means CSS rules (like .indicatorKpiValue) read it
        // automatically — so SAPUI5 re-renders of child controls never lose the color.
        #updateDynamicStyles(sColor) {
            const oRootDom = this.#oRootVBox?.getDomRef();
            if (!oRootDom) return;

            // Single source of truth for the threshold color
            oRootDom.style.setProperty("--indicator-accent", sColor);

            // Left-edge accent stripe
            oRootDom.style.boxShadow =
                "0 2px 16px rgba(0,0,0,0.09), inset 4px 0 0 0 " + sColor;
        }

        // ---- mouse hover handling ----

        #setupMouseHandlers() {
            const oCanvas = document.getElementById(this.#sCanvasId);
            if (!oCanvas) return;

            // If same element, nothing to do
            if (this.#oCurrentCanvasEl === oCanvas) return;

            // Detach from previous element (e.g. after HTML control re-render)
            this.#detachMouseHandlers();

            // Create stable bound handlers once
            if (!this.#oMouseMoveHandler) {
                this.#oMouseMoveHandler  = (e) => this.#onCanvasMouseMove(e);
                this.#oMouseLeaveHandler = ()  => this.#onCanvasMouseLeave();
            }

            oCanvas.addEventListener("mousemove",  this.#oMouseMoveHandler);
            oCanvas.addEventListener("mouseleave", this.#oMouseLeaveHandler);
            this.#oCurrentCanvasEl = oCanvas;
        }

        #detachMouseHandlers() {
            if (this.#oCurrentCanvasEl && this.#oMouseMoveHandler) {
                this.#oCurrentCanvasEl.removeEventListener("mousemove",  this.#oMouseMoveHandler);
                this.#oCurrentCanvasEl.removeEventListener("mouseleave", this.#oMouseLeaveHandler);
            }
            this.#oCurrentCanvasEl = null;
        }

        #onCanvasMouseMove(e) {
            if (!this.#oCanvasSnapshot || this.#aHitAreas.length === 0) return;

            const oCanvas = this.#oCurrentCanvasEl;
            if (!oCanvas) return;

            const rect   = oCanvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            let oNearest  = null;
            let nMinDist  = 16; // hit radius px

            for (const oHit of this.#aHitAreas) {
                const dist = Math.sqrt(Math.pow(mouseX - oHit.x, 2) + Math.pow(mouseY - oHit.y, 2));
                if (dist < nMinDist) { nMinDist = dist; oNearest = oHit; }
            }

            const ctx = oCanvas.getContext("2d");
            // Restore clean chart (putImageData operates in raw pixels, ignores transform)
            ctx.putImageData(this.#oCanvasSnapshot, 0, 0);

            if (oNearest) {
                oCanvas.style.cursor = "pointer";
                this.#drawTooltip(ctx, oNearest, oCanvas.clientWidth);
            } else {
                oCanvas.style.cursor = "default";
            }
        }

        #onCanvasMouseLeave() {
            const oCanvas = this.#oCurrentCanvasEl;
            if (!oCanvas || !this.#oCanvasSnapshot) return;
            oCanvas.getContext("2d").putImageData(this.#oCanvasSnapshot, 0, 0);
            oCanvas.style.cursor = "default";
        }

        // Draw hover tooltip — ctx already has scale(dpr,dpr) from last render
        #drawTooltip(ctx, oHit, cssW) {
            const x      = oHit.x;
            const y      = oHit.y;
            const sVal   = oHit.value.toFixed(2);
            const sTime  = oHit.time;
            const sColor = oHit.color;

            const bW = 88, bH = 46;
            let bX = x - bW / 2;
            let bY = y - bH - 16;

            // Flip below the dot if too close to top
            const bFlip = bY < 4;
            if (bFlip) bY = y + 14;

            // Clamp horizontally
            bX = Math.max(4, Math.min(bX, cssW - bW - 4));

            ctx.save();

            // Drop shadow
            ctx.shadowColor  = "rgba(0,0,0,0.18)";
            ctx.shadowBlur   = 10;
            ctx.shadowOffsetY = 3;

            // White background
            ctx.fillStyle = "#FFFFFF";
            if (ctx.roundRect) {
                ctx.beginPath();
                ctx.roundRect(bX, bY, bW, bH, 7);
                ctx.fill();
            } else {
                ctx.fillRect(bX, bY, bW, bH);
            }

            ctx.shadowColor = "transparent";
            ctx.shadowBlur  = 0;

            // Colored top bar
            ctx.fillStyle = sColor;
            if (ctx.roundRect) {
                ctx.beginPath();
                ctx.roundRect(bX, bY, bW, 4, [7, 7, 0, 0]);
                ctx.fill();
            } else {
                ctx.fillRect(bX, bY, bW, 4);
            }

            // Value
            ctx.fillStyle    = sColor;
            ctx.font         = "bold 15px '72', Arial, sans-serif";
            ctx.textAlign    = "center";
            ctx.textBaseline = "top";
            ctx.fillText(sVal, bX + bW / 2, bY + 9);

            // Timestamp
            ctx.fillStyle    = "#9E9E9E";
            ctx.font         = "10px '72', Arial, sans-serif";
            ctx.textBaseline = "top";
            ctx.fillText(sTime, bX + bW / 2, bY + 29);

            // Arrow
            ctx.fillStyle = "#FFFFFF";
            const arrowBase = bFlip ? bY : bY + bH;
            const arrowTip  = bFlip ? bY - 7 : bY + bH + 7;
            ctx.beginPath();
            ctx.moveTo(x - 6, arrowBase);
            ctx.lineTo(x + 6, arrowBase);
            ctx.lineTo(x,     arrowTip);
            ctx.closePath();
            ctx.fill();

            // Highlight hovered dot
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.fillStyle   = sColor;
            ctx.strokeStyle = "#FFFFFF";
            ctx.lineWidth   = 2;
            ctx.fill();
            ctx.stroke();

            ctx.restore();
        }

        // ---- canvas chart ----
        #renderChart() {
            const oCanvas = document.getElementById(this.#sCanvasId);
            if (!oCanvas) return;

            const dpr  = window.devicePixelRatio || 1;
            const cssW = oCanvas.clientWidth || oCanvas.offsetWidth || 500;
            const cssH = 200;

            // Assigning canvas.width resets both pixels AND context transform
            oCanvas.width  = cssW * dpr;
            oCanvas.height = cssH * dpr;

            const ctx = oCanvas.getContext("2d");
            ctx.scale(dpr, dpr); // all drawing below is in CSS pixels

            ctx.clearRect(0, 0, cssW, cssH);

            const aPoints = this.#aDataPoints;
            const padL = 52, padR = 24, padT = 18, padB = 38;
            const chartW = cssW - padL - padR;
            const chartH = cssH - padT - padB;

            ctx.fillStyle = "#FAFAFA";
            ctx.fillRect(0, 0, cssW, cssH);

            if (aPoints.length < 2) {
                ctx.fillStyle    = "#C8C8C8";
                ctx.font         = "13px '72', Arial, sans-serif";
                ctx.textAlign    = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(this.getI18nText("chart.noData"), cssW / 2, cssH / 2);
                this.#updateDynamicStyles(ACCENT_COLOR);
                this.#aHitAreas = [];
                this.#oCanvasSnapshot = ctx.getImageData(0, 0, cssW * dpr, cssH * dpr);
                return;
            }

            const nLastValue   = aPoints[aPoints.length - 1].value;
            const sActiveColor = this.#getActiveColor(nLastValue);
            // Line + gradient are always the dark neutral color
            const sLineFill  = this.#hexToRgba(LINE_COLOR, 0.12);
            const sLineFade  = this.#hexToRgba(LINE_COLOR, 0);

            const aValues   = aPoints.map(p => p.value);
            const rawMin    = Math.min(...aValues);
            const rawMax    = Math.max(...aValues);
            const nLowCfg   = parseFloat(this.getPropertyValue("thresholdLow"));
            const nHighCfg  = parseFloat(this.getPropertyValue("thresholdHigh"));
            const nRangeMin = Math.min(rawMin, !isNaN(nLowCfg)  ? nLowCfg  : rawMin);
            const nRangeMax = Math.max(rawMax, !isNaN(nHighCfg) ? nHighCfg : rawMax);
            const nExtRange = nRangeMax - nRangeMin || 1;
            const nMin      = nRangeMin - nExtRange * 0.1;
            const nMax      = nRangeMax + nExtRange * 0.1;
            const nDispRange = nMax - nMin;

            const toX = (i) => padL + (i / (aPoints.length - 1)) * chartW;
            const toY = (v) => padT + chartH - ((v - nMin) / nDispRange) * chartH;

            // ── Grid lines ──
            ctx.strokeStyle = GRID_COLOR;
            ctx.lineWidth   = 1;
            const nGridLines = 4;
            for (let i = 0; i <= nGridLines; i++) {
                const y = padT + (i / nGridLines) * chartH;
                ctx.beginPath();
                ctx.moveTo(padL, y);
                ctx.lineTo(padL + chartW, y);
                ctx.stroke();
                const vLabel = nMax - (i / nGridLines) * nDispRange;
                ctx.fillStyle    = "#9E9E9E";
                ctx.font         = "10px '72', Arial, sans-serif";
                ctx.textAlign    = "right";
                ctx.textBaseline = "middle";
                ctx.fillText(vLabel.toFixed(1), padL - 6, y);
            }

            // ── Threshold lines ──
            ctx.setLineDash([5, 4]);
            ctx.lineWidth = 1.5;

            if (!isNaN(nLowCfg)) {
                const sColorLow = this.getPropertyValue("colorBelowLow") || DEFAULT_COLOR_BELOW;
                const yLow = toY(nLowCfg);
                ctx.strokeStyle = sColorLow;
                ctx.beginPath(); ctx.moveTo(padL, yLow); ctx.lineTo(padL + chartW, yLow); ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = sColorLow;
                ctx.font = "bold 9px '72', Arial, sans-serif";
                ctx.textAlign = "left"; ctx.textBaseline = "bottom";
                ctx.fillText("▼ " + nLowCfg, padL + 3, yLow - 2);
                ctx.setLineDash([5, 4]);
            }

            if (!isNaN(nHighCfg)) {
                const sColorHigh = this.getPropertyValue("colorAboveHigh") || DEFAULT_COLOR_ABOVE;
                const yHigh = toY(nHighCfg);
                ctx.strokeStyle = sColorHigh;
                ctx.beginPath(); ctx.moveTo(padL, yHigh); ctx.lineTo(padL + chartW, yHigh); ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = sColorHigh;
                ctx.font = "bold 9px '72', Arial, sans-serif";
                ctx.textAlign = "left"; ctx.textBaseline = "top";
                ctx.fillText("▲ " + nHighCfg, padL + 3, yHigh + 2);
                ctx.setLineDash([5, 4]);
            }

            ctx.setLineDash([]);

            // ── Area fill — neutral dark gradient ──
            const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH);
            grad.addColorStop(0, sLineFill);
            grad.addColorStop(1, sLineFade);

            ctx.beginPath();
            ctx.moveTo(toX(0), toY(aPoints[0].value));
            for (let i = 1; i < aPoints.length; i++) {
                const x0 = toX(i - 1), y0 = toY(aPoints[i - 1].value);
                const x1 = toX(i),     y1 = toY(aPoints[i].value);
                ctx.bezierCurveTo((x0 + x1) / 2, y0, (x0 + x1) / 2, y1, x1, y1);
            }
            ctx.lineTo(toX(aPoints.length - 1), padT + chartH);
            ctx.lineTo(padL, padT + chartH);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();

            // ── Stroke line — always LINE_COLOR ──
            ctx.beginPath();
            ctx.moveTo(toX(0), toY(aPoints[0].value));
            for (let i = 1; i < aPoints.length; i++) {
                const x0 = toX(i - 1), y0 = toY(aPoints[i - 1].value);
                const x1 = toX(i),     y1 = toY(aPoints[i].value);
                ctx.bezierCurveTo((x0 + x1) / 2, y0, (x0 + x1) / 2, y1, x1, y1);
            }
            ctx.strokeStyle = LINE_COLOR;
            ctx.lineWidth   = 2.5;
            ctx.lineJoin    = "round";
            ctx.lineCap     = "round";
            ctx.stroke();

            // ── Dots + time labels + hit areas ──
            this.#aHitAreas = [];
            const nLabelStep = Math.max(1, Math.floor(aPoints.length / 5));

            aPoints.forEach((p, i) => {
                const x = toX(i), y = toY(p.value);
                const bLast = i === aPoints.length - 1;
                const sDotColor = this.#getActiveColor(p.value); // per-point threshold color

                if (bLast) {
                    ctx.beginPath();
                    ctx.arc(x, y, 8, 0, Math.PI * 2);
                    ctx.fillStyle = this.#hexToRgba(sDotColor, 0.18);
                    ctx.fill();
                }

                ctx.beginPath();
                ctx.arc(x, y, bLast ? 4.5 : 3, 0, Math.PI * 2);
                ctx.fillStyle   = bLast ? sDotColor : "#FFFFFF";
                ctx.strokeStyle = sDotColor;
                ctx.lineWidth   = 2;
                ctx.fill();
                ctx.stroke();

                if (i % nLabelStep === 0 || bLast) {
                    ctx.fillStyle    = "#9E9E9E";
                    ctx.font         = "10px '72', Arial, sans-serif";
                    ctx.textAlign    = "center";
                    ctx.textBaseline = "top";
                    ctx.fillText(p.time, x, padT + chartH + 8);
                }

                // Store hit area in CSS pixels for mousemove detection
                this.#aHitAreas.push({ x, y, value: p.value, time: p.time, color: sDotColor });
            });

            // ── Latest value callout bubble ──
            const lastX = toX(aPoints.length - 1);
            const lastY = toY(nLastValue);
            const sVal  = nLastValue.toFixed(2);

            ctx.font         = "bold 11px '72', Arial, sans-serif";
            ctx.textBaseline = "middle";
            const bW = ctx.measureText(sVal).width + 18;
            const bH = 22;
            const bX = Math.max(padL, Math.min(lastX - bW / 2, padL + chartW - bW));
            const bY = Math.max(padT + 2, lastY - bH - 8);

            ctx.fillStyle = sActiveColor;
            if (ctx.roundRect) {
                ctx.beginPath(); ctx.roundRect(bX, bY, bW, bH, 5); ctx.fill();
            } else {
                ctx.fillRect(bX, bY, bW, bH);
            }

            ctx.beginPath();
            ctx.moveTo(lastX - 5, bY + bH);
            ctx.lineTo(lastX + 5, bY + bH);
            ctx.lineTo(lastX,     bY + bH + 5);
            ctx.closePath();
            ctx.fillStyle = sActiveColor;
            ctx.fill();

            ctx.fillStyle    = "#FFFFFF";
            ctx.textAlign    = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(sVal, bX + bW / 2, bY + bH / 2);

            // ── Save snapshot for hover overlay ──
            // Must be captured AFTER all drawing, in raw pixel dimensions
            this.#oCanvasSnapshot = ctx.getImageData(0, 0, cssW * dpr, cssH * dpr);

            // ── Push threshold color to DOM elements ──
            this.#updateDynamicStyles(sActiveColor);
        }

        // ---- CSS injection (once per page load) ----
        #injectStyles() {
            if (document.getElementById("indicatorChartStyles")) return;
            const oStyle = document.createElement("style");
            oStyle.id = "indicatorChartStyles";
            oStyle.textContent = `
@keyframes indicatorBlink {
    0%, 100% { opacity: 1; }
    45%       { opacity: 0.25; }
}
.indicatorChartRoot {
    background: #FFFFFF;
    border-radius: 12px;
    box-shadow: 0 2px 16px rgba(0,0,0,0.09);
    padding: 20px 24px 16px;
    box-sizing: border-box;
    min-height: 320px;
    display: flex;
    flex-direction: column;
    transition: box-shadow 0.4s ease;
}
.indicatorChartHeader {
    margin-bottom: 12px;
}
.indicatorChartTitle .sapMTitle {
    font-size: 1.05rem !important;
    font-weight: 700 !important;
    color: #32363A !important;
}
.indicatorLiveBadge {
    background: linear-gradient(135deg, #0070F2 0%, #0040E5 100%);
    color: #FFFFFF !important;
    font-size: 0.65rem;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 20px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    display: inline-block;
    animation: indicatorBlink 1.8s ease-in-out infinite;
}
.indicatorKpiRow {
    margin-bottom: 14px;
    flex-wrap: wrap;
    gap: 24px;
}
.indicatorKpiBlock {
    min-width: 80px;
    flex: 0 0 auto;
}
.indicatorKpiLabel.sapMText {
    font-size: 0.68rem !important;
    color: #9E9E9E !important;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 2px;
}
.indicatorKpiValue.sapMText {
    font-size: 2rem !important;
    font-weight: 700 !important;
    color: var(--indicator-accent, #0070F2) !important;
    line-height: 1.1;
    transition: color 0.35s ease;
}
.indicatorKpiSmall.sapMText {
    font-size: 0.85rem !important;
    font-weight: 600 !important;
    color: #32363A !important;
}
.indicatorStatusBar {
    margin-top: 10px;
    gap: 5px;
    flex: 0 0 auto;
}
.indicatorStatusDot.sapMText {
    font-size: 0.5rem !important;
    color: var(--indicator-accent, #0070F2) !important;
    vertical-align: middle;
    transition: color 0.35s ease;
}
.indicatorStatusText.sapMText {
    font-size: 0.72rem !important;
    color: #9E9E9E !important;
}
.indicatorErrorText.sapMText {
    font-size: 0.72rem !important;
    color: #BB0000 !important;
    background: rgba(187,0,0,0.06);
    border-radius: 6px;
    padding: 5px 10px;
    margin-top: 6px;
}
            `;
            document.head.appendChild(oStyle);
        }
    }

    return IndicatorChart;
});
