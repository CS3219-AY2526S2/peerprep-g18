# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Prevent Python from writing .pyc files and buffer stdout/stderr
# (Essential for seeing your FastAPI logs in real-time)
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file first to leverage Docker's cache
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy everything from your local directory into /app in the container
COPY . .

# Expose the port your Question Service uses
EXPOSE 6770

# Run Lambda handler
CMD ["python", "-m", "awslambdaric", "app.main.handler"]