FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 1234

# Run Lambda handler
CMD ["python", "-m", "awslambdaric", "main.handler"]