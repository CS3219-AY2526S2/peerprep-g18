# PeerPrep AWS Estimated Pricing (ap-southeast-1) - 2026 Update

This document provides a detailed breakdown of the estimated monthly costs for the PeerPrep infrastructure in the **Singapore (ap-southeast-1)** region, updated for **April 2026**.

---

## 1. Fixed Monthly Costs (Baseline)

These costs are incurred as long as the infrastructure is provisioned. Note the 2026 price adjustments for networking and IP addresses.

| Service | Configuration | Estimated Monthly Cost |
| :--- | :--- | :--- |
| **NAT Gateway** | 1x Managed NAT Gateway ($0.059/hr) | ~$43.07 |
| **Public IPv4** | 1x Elastic IP for NAT ($0.005/hr) | ~$3.60 |
| **ElastiCache** | 1x `cache.t4g.small` (Valkey/Redis) | ~$23.36 ($0.032/hr) |
| **Secrets Manager** | 4 Secret Containers | $1.60 ($0.40/secret) |
| **ECR Storage** | 7 Repos (35 images @ 200MB) | ~$0.70 ($0.10/GB) |
| **TOTAL BASELINE** | | **~$72.33 / month** |

---

## 2. Usage-Based Costs (Estimated)

### Compute (Lambda & ECS)
*   **AWS Lambda** (Stateless Services):
    *   **Requests**: $0.20 per 1M requests.
    *   **Duration**: $0.0000133334 per GB-second (ARM/Graviton2).
    *   *2026 Note*: Initialization (INIT) phase is now billed.
*   **AWS ECS on EC2** (Stateful Services):
    *   **Instance Type**: 1x `t4g.small` (2 vCPU, 2 GB RAM).
    *   **Monthly Cost**: **~$15.48 / month** ($0.0212/hr).

### Networking & API
*   **HTTP API (API Gateway)**: $1.00 per 1M requests.
*   **CloudFront Data Transfer**: ~$0.12 per GB (Asia Pacific).
*   **NAT Gateway Data Processing**: $0.059 per GB.

### Storage
*   **Amazon S3**: $0.025 per GB-month.
*   **Firestore**: (External) Usage-based.

---

## 3. Cost Optimization Strategies Applied

1.  **Valkey Engine**: Using the Valkey engine for ElastiCache provides the best price-performance in 2026.
2.  **Graviton2 (ARM)**: Using `t4g` instances and ARM-based Lambda functions saves ~20% compared to x86.
3.  **Single NAT Gateway**: Essential for dev, as multi-AZ would double the ~$43/mo baseline.
4.  **VPC Endpoints**: (Recommended) Implementing VPC Endpoints for S3/Firestore can bypass NAT processing fees.
