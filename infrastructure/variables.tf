variable "frontend_url" {
  description = "The URL of the deployed frontend (e.g., CloudFront URL)"
  type        = string
  default     = "*" # Default to * for initial bootstrap, managed by CI/CD later
}

variable "region" {
  description = "AWS Region"
  type        = string
  default     = "ap-southeast-1"
}
