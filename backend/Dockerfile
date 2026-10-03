# RideShift FastAPI backend (proposal: Backend = Python + FastAPI)
FROM python:3.12-slim

WORKDIR /srv

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY main.py ./
COPY tools ./tools
# survey dataset is generated on first boot when missing (see app/services/trend.py)
COPY data ./data

EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
