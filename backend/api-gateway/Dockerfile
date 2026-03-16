FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 1234

# Run uvicorn server on port 1234 with hot-reloading
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "1234", "--reload"]