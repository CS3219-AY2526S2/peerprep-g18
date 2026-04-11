# PeerPrep Deployment Q&A Summary (AWS Architecture)

This document summarizes the key architectural decisions and Q&A from the deployment planning session to share with the team.

---

### **Q1: Where do we store our secrets (Firebase JSON, API Keys, etc.)?**
**Answer:** We use a two-tiered approach:
1.  **AWS Secrets Manager:** For application-level secrets (e.g., the contents of `firebase-service-account.json` and SMTP passwords). Terraform creates the "secret container," and the team manually pastes the values into the **AWS Console** once.
2.  **GitHub Actions Secrets:** For deployment-level credentials (e.g., `AWS_ACCESS_KEY_ID`). These are used by the CI/CD pipeline to push code and update services.

---

### **Q2: Why are we using a "Single Node" Redis Cluster for 3 different services?**
**Answer:** To minimize fixed monthly costs.
*   **Infrastructure:** We provision one small `cache.t4g.micro` node (~$12/month).
*   **Services:** All 3 services (API Gateway, Matching, Collaboration) will share this same Redis endpoint.
*   **Performance:** A single node is more than capable of handling the traffic for an MVP/practice platform.
*   **Comparison:** Running 3 separate nodes would triple the cost to ~$36/month without adding significant value for this project stage.     

---

### **Q3: Does sharing a Redis Node break the "Microservices Isolation"?**
**Answer:** No, because we maintain **Logical Isolation**:
*   **Application Logic:** Each service is configured with a unique **Prefix** (e.g., `match:`, `collab:`, `gw:`).
*   **Environment Variables:** All services receive the same `REDIS_URL`, but they "stay in their own lane" by only touching keys with their specific prefix.

---

### **Q4: Does using a shared, single-threaded Redis node affect scalability?**
**Answer:**
*   **Single-threaded Nuance:** While Redis's core command execution is single-threaded (atomicity without locks), modern versions (7.0+) utilize multi-threading for I/O and background tasks. For PeerPrep's current scale, a `cache.t4g.micro` node can handle tens of thousands of ops/sec, making network latency or application logic the more likely bottleneck.
*   **Architectural Decision:** We proceed with a shared node for cost-efficiency ($0.016/hr) but mitigate risks via:
    1. **Key Namespacing:** Using prefixes (e.g., `match:` vs `collab:`) to prevent collisions.
    2. **Logical Separation:** Utilizing Redis database indexes (0-15) to isolate service data.
    3. **Future Path:** A clear "Escape Hatch" exists to transition to **Redis Cluster Mode** (sharding) or dedicated "Sidecar" nodes if "Noisy Neighbor" effects impact performance.

---

### **Q5: If I want to copy a service to a new project, is it still "portable"?**
**Answer:** Yes, 100%.
*   **Zero Code Changes:** The service code (Python/Node) only knows it needs a `REDIS_URL`. It doesn't know if that URL points to a shared or dedicated Redis.
*   **Portability:** To move a service, you just copy the service folder. The "sharing" is a decision made in the **Infrastructure layer** (Terraform), not the **Application layer** (Code). In a new project, you can easily point the same service to a dedicated Redis instead.

---

### **Q6: Why did `terraform apply` fail with `AccessDeniedException`?**
**Answer:** This happens because the IAM User (e.g., `Benny_IAM`) lacks the specific permissions to create resources like VPCs, ECR repositories, or Secrets.
*   **The Fix:** You must attach the necessary policies to your IAM User in the **AWS Console**.
*   **Recommendation for Dev:** Attach the `AdministratorAccess` managed policy for full control during the setup phase.
*   **Least Privilege Alternative:** Attach specific policies: `AmazonVPCFullAccess`, `AmazonEC2ContainerRegistryFullAccess`, `SecretsManagerReadWrite`, `AmazonElastiCacheFullAccess`, and `IAMFullAccess`.

---

### **Q7: Can I use 'terraform destroy' to stop AWS charges temporarily?**
**Answer:** Yes, it stops the billing for high-cost resources like NAT Gateway and Redis, but there are consequences to consider:
*   **Secret Deletion:** Because 'recovery_window_in_days' is set to 0, all secret values (like the Firebase JSON) are permanently wiped and must be manually re-uploaded during the next deploy.
*   **Infrastructure State:** Any Docker images in ECR will be deleted, requiring you to re-run your CI/CD pipelines to rebuild and push images before the next full deployment.
*   **Redis Data:** All ephemeral session state (matching queues, tickets) will be lost.

---

### **Q8: Why can't I see my secrets in the AWS Secrets Manager Console?**
**Answer:** If 'terraform apply' succeeded but the secrets aren't visible, check the following:
*   **Region Mismatch:** Ensure your AWS Console is set to the correct region (e.g., **ap-southeast-1** for Singapore). Infrastructure is region-specific, and secrets created in one region will not appear in another.
*   **IAM Permissions:** Your IAM user must have 'secretsmanager:ListSecrets' and 'secretsmanager:DescribeSecret' permissions to see them in the list.
*   **Console Filters:** Clear any active search filters in the Secrets Manager dashboard and refresh the page.
