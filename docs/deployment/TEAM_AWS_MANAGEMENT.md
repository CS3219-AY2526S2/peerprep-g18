# Team AWS Management & Cost Optimization

This document outlines the strategy for managing AWS credits, team collaboration, and cost-efficiency for the PeerPrep project. 

---

## 1. AWS Credit Management Strategy

In a team of 5 where each member may receive individual AWS credits (e.g., $50-100), the most efficient approach is to **consolidate** resources into a single "Management Account" (the Team Lead's account).

### A. Promo Code Consolidation (Recommended)
If team members receive credits as **Promo Codes** (e.g., `LINK-XXXX-XXXX`):
*   **Action:** All team members should provide their codes to the Team Lead.
*   **Redemption:** The Team Lead redeems all codes in their account via **Billing Dashboard > Credits > Redeem Credit**.
*   **Benefit:** This creates a single "pool" of $250-$350 in one account, making it easier to manage the VPC, NAT Gateways, and database instances without splitting resources across accounts.

### B. AWS Organizations (The "Credit Pooling" Method)
If credits are strictly locked to individual accounts (not codes), you can "pool" them using AWS Organizations:
1.  **Management Account:** The Team Lead's account acts as the "Payer."
2.  **Invite Members:** The Lead invites the 4 teammates' AWS Account IDs to join the Organization.
3.  **Enable Credit Sharing:** In the **Billing Preferences** of the Lead's account, ensure **"Credit Sharing"** is enabled.
4.  **How it works:** When the Lead's account incurs costs (e.g., $100 for a month), AWS will automatically apply the $50 credits from the member accounts to the consolidated "family" bill.

---

## 2. Team Collaboration (IAM Setup)

The Team Lead hosts the infrastructure. To let teammates work on it, the Lead creates **IAM Users** within the Lead's account.

### How Billing works with IAM:
*   **The Owner Pays:** Charges are always billed to the account **where the resource was created**, regardless of which IAM user created it.
*   **IAM vs. Personal Accounts:** When a teammate logs in as an IAM user to the Lead's account, they are working "inside" the Lead's environment. Their own personal AWS account (and its $50 credit) remains untouched **unless** you have linked them via AWS Organizations (see Section 1.B above).

### Steps to Add Team Members:
1.  **Create IAM Group:** Create a group named `PeerPrep-Developers`.
2.  **Attach Policy:** Attach the `AdministratorAccess` (or a more restrictive `PowerUserAccess`) policy to this group.
3.  **Create IAM Users:** Create a unique username for each teammate.
4.  **Security:** 
    *   Enable **Console Access**.
    *   Require a **Password Reset** on first login.
    *   (Optional but Recommended) Enforce **MFA** for all users.
5.  **Provision Access Keys:** If teammates need to run Terraform from their local machines, generate **Access Keys** for their IAM users.

---

## 3. Cost-Saving Guidelines (Budget: $50-$100)

AWS costs can accumulate quickly. Follow these rules to maximize your credit runway:

### A. Networking (The "NAT Gateway" Trap)
*   **Rule:** Only use **one** NAT Gateway for the entire VPC.
*   **Terraform Config:** Set `single_nat_gateway = true` in `vpc.tf`.
*   **Cost:** ~$32/month for one vs. ~$64/month for high availability (2 AZs).

### B. Compute & Caching
*   **ElastiCache (Redis):** Use the smallest available instance (e.g., `cache.t4g.micro`).
*   **ECS Tasks:** Set very low CPU/Memory limits (e.g., 0.25 vCPU and 0.5 GB RAM) for the Matching and Collaboration services.
*   **Lambda:** Only pay per request. Avoid high-concurrency settings during development.

### C. Resource Cleanup
*   **Dev Hours:** If the team is not working for several days (e.g., during finals), consider using `terraform destroy` to tear down the infrastructure and stop the billing clock. 
*   **CRITICAL:** Remember that `terraform destroy` will wipe your Firestore data and Secrets if they are managed by Terraform. Ensure your database is backed up or manually managed if you do this.

---

## 4. Summary Recommendation for the Lead

1.  **Collect all Promo Codes** and apply them to your account immediately.
2.  **Setup the IAM Users** so your team can help with Step 2.1 and beyond.
3.  **Monitor the Billing Dashboard** daily to ensure no "surprise" costs from unmanaged resources.
