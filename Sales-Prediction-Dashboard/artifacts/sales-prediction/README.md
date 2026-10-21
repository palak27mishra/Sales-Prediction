# SalesPredict AI

A browser-only analytics workspace for exploring the supplied Advertising dataset. The interface uses semantic HTML, CSS and vanilla JavaScript; Vite is only the development and build shell.

## Run locally in VS Code

This app lives in the pnpm workspace, so open the repository root in VS Code rather than this folder by itself.

1. In a terminal at the repository root, install the workspace dependencies:

   ```bash
   pnpm install
   ```

2. Start the dashboard:

   ```bash
   pnpm --filter @workspace/sales-prediction run dev
   ```

3. Open the local URL printed in the terminal. Vite serves the bundled CSV from `public/Advertising.csv`. Do not open `index.html` with a `file://` URL because browsers block the CSV request from local files.

## Project files

- `index.html` — complete single-page app and semantic navigation sections.
- `style.css` — responsive design system, components and reduced-motion support.
- `script.js` — CSV parser, observed-data charts, validation, and local estimate.
- `public/Advertising.csv` — the supplied 200-row source data.
- `assets/images/` — optional project images; intentionally empty because the visual is built from CSS and data charts.

## Data, charts and estimate behavior

The app reads the bundled CSV in the browser and derives row count, means, ranges, Pearson correlations and the scatter plot directly from complete CSV rows. The correlations are descriptive associations only. They are not causal contribution or lift estimates. No actual-versus-predicted chart or unverified model metrics are shown.

The provided notebook's current regression model trains on **TV spend only**. That Python model is not connected to this frontend. The form's three-input output is explicitly a **local illustrative estimate**, not an ML prediction: it standardizes the three spend features using their observed standard deviations, finds the five nearest rows in the source data, and averages their observed sales values. It uses no generated/random values, makes no network request, and does not guarantee future sales.

## Later Flask / FastAPI integration

Once a backend has a trained model compatible with all three inputs, replace the local estimate call in the form submit handler in `script.js` with a request to the backend. The contract can be:

```http
POST /predict
Content-Type: application/json
```

Request body:

```json
{
  "tv": 150,
  "radio": 25,
  "newspaper": 20
}
```

Expected response:

```json
{
  "predicted_sales": 18.5
}
```

The request and response values above are illustrative only. Do not connect the three-input contract to the supplied TV-only notebook model without retraining and validating a model that accepts all three features.

For a same-origin deployment, use `/predict`. For a separate backend origin, set a documented API base URL and configure the backend's CORS allowlist for the frontend origin. Send JSON with `fetch`, check `response.ok`, validate that `predicted_sales` is finite, and show failures in the existing accessible error region. The backend must provide the actual estimate; never label the current local nearest-row lookup as a model result.
