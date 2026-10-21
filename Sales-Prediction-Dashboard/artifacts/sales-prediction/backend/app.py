"""FastAPI service for the SalesPredict AI three-channel regression model."""

from __future__ import annotations

import csv
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, Request
from pydantic import BaseModel, ConfigDict, Field
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split

FEATURES = ("tv", "radio", "newspaper")
FEATURE_LABELS = {"tv": "TV", "radio": "Radio", "newspaper": "Newspaper"}
DATASET_PATH = Path(__file__).resolve().parents[1] / "public" / "Advertising.csv"
MODEL_NAME = "Multiple linear regression"
MODEL_VERSION = "1.0.0"
MAX_INPUT = 10_000


class PredictionInput(BaseModel):
    """Advertising budgets accepted by POST /predict."""

    model_config = ConfigDict(extra="forbid")

    tv: Annotated[float, Field(ge=0, le=MAX_INPUT, allow_inf_nan=False)]
    radio: Annotated[float, Field(ge=0, le=MAX_INPUT, allow_inf_nan=False)]
    newspaper: Annotated[float, Field(ge=0, le=MAX_INPUT, allow_inf_nan=False)]


class PredictionOutput(BaseModel):
    predicted_sales: float
    model_name: str
    model_version: str


def load_dataset() -> tuple[list[list[float]], list[float]]:
    """Load and validate the shared Advertising.csv source file."""
    if not DATASET_PATH.is_file():
        raise RuntimeError(f"Training dataset not found: {DATASET_PATH}")

    features: list[list[float]] = []
    sales: list[float] = []
    with DATASET_PATH.open("r", newline="", encoding="utf-8") as source:
        reader = csv.DictReader(source)
        required = {"TV", "radio", "newspaper", "sales"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise RuntimeError("Advertising.csv is missing one or more required columns.")

        for row in reader:
            try:
                sample = [float(row["TV"]), float(row["radio"]), float(row["newspaper"])]
                outcome = float(row["sales"])
            except (TypeError, ValueError):
                continue
            if all(value >= 0 for value in sample) and outcome >= 0:
                features.append(sample)
                sales.append(outcome)

    if len(features) < 8:
        raise RuntimeError("At least eight valid observations are required to train the model.")
    return features, sales


def train_model() -> dict[str, Any]:
    """Evaluate on a fixed holdout split, then fit the serving model on all rows."""
    features, sales = load_dataset()
    x_train, x_test, y_train, y_test = train_test_split(
        features, sales, test_size=0.25, random_state=1
    )

    evaluation_model = LinearRegression()
    evaluation_model.fit(x_train, y_train)
    holdout_predictions = evaluation_model.predict(x_test)

    serving_model = LinearRegression()
    serving_model.fit(features, sales)

    evaluation = {
        "method": "75/25 holdout split; random_state=1",
        "train_rows": len(x_train),
        "test_rows": len(x_test),
        "r2": float(r2_score(y_test, holdout_predictions)),
        "mae": float(mean_absolute_error(y_test, holdout_predictions)),
        "rmse": float(mean_squared_error(y_test, holdout_predictions) ** 0.5),
    }
    holdout_chart = [
        {"actual": float(actual), "predicted": float(predicted)}
        for actual, predicted in zip(y_test, holdout_predictions, strict=True)
    ]
    coefficients = {
        feature: float(coefficient)
        for feature, coefficient in zip(FEATURES, serving_model.coef_, strict=True)
    }

    return {
        "model": serving_model,
        "dataset_rows": len(features),
        "evaluation": evaluation,
        "holdout_chart": holdout_chart,
        "coefficients": coefficients,
        "intercept": float(serving_model.intercept_),
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Train once from the bundled source data when the service starts.
    app.state.model_bundle = train_model()
    yield


app = FastAPI(
    title="SalesPredict AI model API",
    description="Three-input sales estimates from the supplied Advertising dataset.",
    version=MODEL_VERSION,
    lifespan=lifespan,
)


def get_model_bundle(request: Request) -> dict[str, Any]:
    return request.app.state.model_bundle


@app.get("/health")
def health(request: Request) -> dict[str, str]:
    get_model_bundle(request)
    return {"status": "ready", "model_name": MODEL_NAME, "model_version": MODEL_VERSION}


@app.get("/model-info")
def model_info(request: Request) -> dict[str, Any]:
    bundle = get_model_bundle(request)
    return {
        "status": "ready",
        "model_name": MODEL_NAME,
        "model_version": MODEL_VERSION,
        "features": [
            {"key": feature, "label": FEATURE_LABELS[feature]} for feature in FEATURES
        ],
        "target": "sales",
        "dataset_rows": bundle["dataset_rows"],
        "evaluation": bundle["evaluation"],
        "coefficients": bundle["coefficients"],
        "intercept": bundle["intercept"],
    }


@app.post("/predict", response_model=PredictionOutput)
def predict(payload: PredictionInput, request: Request) -> PredictionOutput:
    bundle = get_model_bundle(request)
    features = [[payload.tv, payload.radio, payload.newspaper]]
    predicted_sales = float(bundle["model"].predict(features)[0])
    return PredictionOutput(
        predicted_sales=predicted_sales,
        model_name=MODEL_NAME,
        model_version=MODEL_VERSION,
    )
