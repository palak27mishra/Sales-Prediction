/* SalesPredict AI — CSV-backed analytics and connected Python regression API. */
const channels = [
  { key: "tv", label: "TV", color: "#58A6FF", rangeId: "tvRange", inputId: "tvInput" },
  { key: "radio", label: "Radio", color: "#70D6BE", rangeId: "radioRange", inputId: "radioInput" },
  { key: "newspaper", label: "Newspaper", color: "#E6B76C", rangeId: "paperRange", inputId: "newspaperInput" },
];
const elements = {
  form: document.querySelector("#predictionForm"),
  predictButton: document.querySelector("#predictButton"),
  formError: document.querySelector("#formError"),
  resultPlaceholder: document.querySelector("#resultPlaceholder"),
  resultContent: document.querySelector("#resultContent"),
  resultError: document.querySelector("#dataError"),
  predictionError: document.querySelector("#predictionError"),
  menuToggle: document.querySelector("#menuToggle"),
  mobileNav: document.querySelector("#mobileNav"),
};
let observations = [];
let datasetReady = false;
let modelInfo = null;
let modelReady = false;

function apiUrl(path) {
  const baseUrl = import.meta.env?.BASE_URL ?? "./";
  return new URL(`${baseUrl}${path.replace(/^\/+/, "")}`, document.baseURI);
}

async function fetchApiJson(path, options = {}) {
  const response = await fetch(apiUrl(path), options);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.detail;
    const message = Array.isArray(detail)
      ? detail.map((issue) => issue.msg).join("; ")
      : typeof detail === "string" ? detail : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload;
}

// Parse the source CSV directly; blank/malformed records are ignored.
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",").map((value) => value.trim().toLowerCase());
  return lines.map((line) => {
    const cells = line.split(",");
    const record = {};
    headers.forEach((header, index) => { record[header] = Number(cells[index]); });
    return record;
  }).filter((row) => channels.every(({ key }) => Number.isFinite(row[key])) && Number.isFinite(row.sales));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function correlation(first, second) {
  const firstMean = mean(first);
  const secondMean = mean(second);
  const numerator = first.reduce((sum, value, index) => sum + (value - firstMean) * (second[index] - secondMean), 0);
  const denominator = Math.sqrt(first.reduce((sum, value) => sum + (value - firstMean) ** 2, 0) * second.reduce((sum, value) => sum + (value - secondMean) ** 2, 0));
  return denominator ? numerator / denominator : 0;
}

function formatNumber(value, digits = 1) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

function getStats() {
  const sales = observations.map((row) => row.sales);
  const stats = { salesAverage: mean(sales), salesMin: Math.min(...sales), salesMax: Math.max(...sales) };
  channels.forEach((channel) => {
    const values = observations.map((row) => row[channel.key]);
    stats[channel.key] = { average: mean(values), min: Math.min(...values), max: Math.max(...values), sd: standardDeviation(values), correlation: correlation(values, sales) };
  });
  return stats;
}

function setDataError(message) {
  elements.resultPlaceholder.hidden = true;
  elements.resultContent.hidden = true;
  elements.predictionError.hidden = true;
  elements.resultError.hidden = false;
  document.querySelector("#dataErrorText").textContent = message;
  document.querySelector("#recordCount").textContent = "—";
}

function renderMetrics(stats) {
  document.querySelector("#recordCount").textContent = new Intl.NumberFormat("en").format(observations.length);
  document.querySelector("#averageSales").textContent = formatNumber(stats.salesAverage);
  const strongest = [...channels].sort((a, b) => Math.abs(stats[b.key].correlation) - Math.abs(stats[a.key].correlation))[0];
  document.querySelector("#topChannel").textContent = strongest.label;
  document.querySelector("#topChannelNote").textContent = `r = ${formatNumber(stats[strongest.key].correlation, 3)} with observed sales`;
  channels.forEach((channel) => {
    document.querySelector(`#${channel.rangeId}`).textContent = `${formatNumber(stats[channel.key].min)}–${formatNumber(stats[channel.key].max)}`;
  });
}

function renderSpendChart(stats) {
  const maximum = Math.max(...channels.map(({ key }) => stats[key].average));
  const rows = channels.map(({ key, label, color }) => `
    <div class="bar-row" title="${label} average spend: ${formatNumber(stats[key].average)} dataset units">
      <span>${label}</span><div class="bar-track"><div class="bar-fill" style="--bar-width:${(stats[key].average / maximum * 100).toFixed(1)}%;--bar-color:${color}"></div></div>
      <span class="bar-val">${formatNumber(stats[key].average)}</span>
    </div>`).join("");
  document.querySelector("#spendChart").innerHTML = `<div class="bar-chart">${rows}</div>`;
}

function renderCorrelations(stats) {
  const rows = [...channels].map(({ key, label, color }) => {
    const value = stats[key].correlation;
    const width = `${Math.abs(value) * 50}%`;
    const left = value >= 0 ? "50%" : `calc(50% - ${width})`;
    return `<div class="corr-row" title="${label} Pearson correlation with sales: ${formatNumber(value, 3)}">
      <span class="corr-name">${label}</span><div class="corr-track"><span class="corr-zero"></span><span class="corr-fill" style="--corr-width:${width};--corr-left:${left};--corr-color:${color}"></span></div><span class="corr-value">${value >= 0 ? "+" : ""}${formatNumber(value, 3)}</span>
    </div>`;
  }).join("");
  document.querySelector("#correlationChart").innerHTML = rows;
}

// A literal share of recorded ad-spend totals, not an attribution of sales.
function renderChannelShare() {
  const totals = channels.map((channel) => ({
    ...channel,
    spend: observations.reduce((sum, row) => sum + row[channel.key], 0),
  }));
  const overallSpend = totals.reduce((sum, channel) => sum + channel.spend, 0);
  document.querySelector("#channelShare").innerHTML = totals.map((channel) => {
    const share = overallSpend ? channel.spend / overallSpend * 100 : 0;
    return `<div class="share-row" title="${channel.label}: ${formatNumber(channel.spend)} dataset units, ${formatNumber(share, 1)}% of recorded ad spend">
      <span class="share-label"><i class="channel-dot" style="background:${channel.color}"></i>${channel.label}</span>
      <span class="share-track"><i style="--share-width:${share.toFixed(1)}%;--share-color:${channel.color}"></i></span>
      <strong>${formatNumber(share, 1)}%</strong>
    </div>`;
  }).join("");
}

// Every plotted dot is one row from the loaded CSV (not sampled or synthesized).
function renderPredictionChart(info) {
  const chart = document.querySelector("#scatterChart");
  const points = info?.holdout_chart ?? [];
  if (!points.length) {
    chart.innerHTML = '<p class="chart-empty">Holdout predictions are unavailable while the model service is offline.</p>';
    document.querySelector("#predictionChartCount").textContent = "unavailable";
    return;
  }
  const width = 550;
  const height = 150;
  const pad = { top: 7, right: 10, bottom: 25, left: 36 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const allValues = points.flatMap(({ actual, predicted }) => [actual, predicted]);
  const xMin = Math.min(...allValues);
  const xMax = Math.max(...allValues);
  const range = xMax - xMin || 1;
  const xPos = (value) => pad.left + ((value - xMin) / (xMax - xMin)) * plotWidth;
  const yPos = (value) => pad.top + plotHeight - ((value - xMin) / range) * plotHeight;
  const gridLines = [0, 0.5, 1].map((fraction) => {
    const y = pad.top + plotHeight * fraction;
    const label = formatNumber(xMax - range * fraction, 0);
    return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#26354B" stroke-width="1"/><text x="${pad.left - 7}" y="${y + 3}" text-anchor="end" fill="#778AA2" font-size="9">${label}</text>`;
  }).join("");
  const dots = points.map(({ actual, predicted }, index) => `<circle cx="${xPos(actual).toFixed(1)}" cy="${yPos(predicted).toFixed(1)}" r="2.3" fill="#58A6FF" fill-opacity=".62"><title>Holdout row ${index + 1}: actual ${formatNumber(actual, 2)}, predicted ${formatNumber(predicted, 2)} dataset units</title></circle>`).join("");
  chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    ${gridLines}<line x1="${pad.left}" y1="${yPos(xMin)}" x2="${width - pad.right}" y2="${yPos(xMax)}" stroke="#E6B76C" stroke-dasharray="4 4" stroke-width="1.3"/>
    <line x1="${pad.left}" y1="${pad.top + plotHeight}" x2="${width - pad.right}" y2="${pad.top + plotHeight}" stroke="#40516A"/>
    ${dots}<text x="${pad.left + plotWidth / 2}" y="${height - 3}" text-anchor="middle" fill="#889BB2" font-size="9">Actual sales · dataset units</text>
    <text x="9" y="${pad.top + plotHeight / 2}" transform="rotate(-90 9 ${pad.top + plotHeight / 2})" text-anchor="middle" fill="#889BB2" font-size="9">Predicted sales</text>
  </svg>`;
  document.querySelector("#predictionChartCount").textContent = `${points.length} holdout rows`;
}

function updateDashboard() {
  const stats = getStats();
  renderMetrics(stats);
  renderSpendChart(stats);
  renderCorrelations(stats);
  renderChannelShare();
  datasetReady = true;
  document.querySelector("#dataError").hidden = true;
}

async function loadDataset() {
  const baseUrl = import.meta.env?.BASE_URL ?? "./";
  try {
    const response = await fetch(new URL(`${baseUrl}Advertising.csv`, document.baseURI));
    if (!response.ok) throw new Error(`CSV request returned ${response.status}.`);
    observations = parseCsv(await response.text());
    if (observations.length === 0) throw new Error("No complete observations were found in the CSV.");
    updateDashboard();
  } catch (error) {
    datasetReady = false;
    setDataError(`Could not load the source CSV. ${error.message}`);
  }
}

function showFormError(message, field) {
  elements.formError.textContent = message;
  elements.formError.hidden = false;
  if (field) field.setAttribute("aria-invalid", "true");
}

function clearFormError() {
  elements.formError.textContent = "";
  elements.formError.hidden = true;
  channels.forEach(({ inputId }) => document.getElementById(inputId).removeAttribute("aria-invalid"));
}

function getScenario() {
  const result = {};
  for (const { key, inputId, label } of channels) {
    const input = document.getElementById(inputId);
    const raw = input.value.trim();
    if (!raw) {
      showFormError(`Enter a ${label} spend value to continue.`, input);
      input.focus();
      return null;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 10000) {
      showFormError(`${label} spend must be a number from 0 to 10,000 dataset units.`, input);
      input.focus();
      return null;
    }
    result[key] = value;
  }
  return result;
}

// This is intentionally a transparent nearest-row lookup, not the notebook's ML model.
function estimateFromNearestRows(scenario) {
  const stats = getStats();
  const distances = observations.map((row, index) => {
    const squaredDistance = channels.reduce((sum, { key }) => {
      const scale = stats[key].sd || 1;
      return sum + ((scenario[key] - row[key]) / scale) ** 2;
    }, 0);
    return { row, index, distance: Math.sqrt(squaredDistance) };
  }).sort((a, b) => a.distance - b.distance);
  const nearest = distances.slice(0, Math.min(5, distances.length));
  return {
    averageSales: mean(nearest.map(({ row }) => row.sales)),
    closest: nearest[0],
    averageDistance: mean(nearest.map(({ distance }) => distance)),
  };
}

function showEstimate(estimate) {
  elements.resultError.hidden = true;
  elements.resultPlaceholder.hidden = true;
  elements.resultContent.hidden = false;
  document.querySelector("#resultValue").textContent = formatNumber(estimate.averageSales, 2);
  document.querySelector("#nearestRow").textContent = `#${estimate.closest.index + 1} · ${formatNumber(estimate.closest.row.sales)} sales`;
  document.querySelector("#nearestDistance").textContent = formatNumber(estimate.averageDistance, 2);
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFormError();
  if (!datasetReady) {
    showFormError("The source dataset is not available yet. Retry loading it below.");
    return;
  }
  const scenario = getScenario();
  if (!scenario) return;
  elements.predictButton.disabled = true;
  elements.predictButton.classList.add("is-loading");
  elements.predictButton.querySelector(".button-text").textContent = "Comparing rows…";
  // Briefly expose the loading state while keeping the local calculation responsive.
  await new Promise((resolve) => window.setTimeout(resolve, 320));
  showEstimate(estimateFromNearestRows(scenario));
  elements.predictButton.disabled = false;
  elements.predictButton.classList.remove("is-loading");
  elements.predictButton.querySelector(".button-text").textContent = "Explore estimate";
});

elements.form.addEventListener("reset", () => {
  window.setTimeout(() => {
    clearFormError();
    elements.resultContent.hidden = true;
    elements.resultError.hidden = true;
    elements.resultPlaceholder.hidden = false;
    elements.predictButton.querySelector(".button-text").textContent = "Explore estimate";
  }, 0);
});

document.querySelector("#exampleButton").addEventListener("click", () => {
  if (!datasetReady) return;
  const stats = getStats();
  channels.forEach(({ key, inputId }) => { document.getElementById(inputId).value = stats[key].average.toFixed(1); });
  clearFormError();
  document.getElementById("tvInput").focus();
});

document.querySelector("#retryButton").addEventListener("click", loadDataset);

elements.menuToggle.addEventListener("click", () => {
  const isExpanded = elements.menuToggle.getAttribute("aria-expanded") === "true";
  elements.menuToggle.setAttribute("aria-expanded", String(!isExpanded));
  elements.menuToggle.setAttribute("aria-label", isExpanded ? "Open navigation" : "Close navigation");
  elements.mobileNav.hidden = isExpanded;
});

elements.mobileNav.addEventListener("click", (event) => {
  if (event.target.closest("a")) {
    elements.mobileNav.hidden = true;
    elements.menuToggle.setAttribute("aria-expanded", "false");
    elements.menuToggle.setAttribute("aria-label", "Open navigation");
  }
});

// Reflect the section currently in view in the desktop navigation.
const navLinks = [...document.querySelectorAll(".side-nav .nav-link")];
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navLinks.forEach((link) => link.classList.toggle("active", link.hash === `#${entry.target.id}`));
    });
  }, { rootMargin: "-25% 0px -65% 0px" });
  document.querySelectorAll(".page-section").forEach((section) => observer.observe(section));
}

loadDataset();
