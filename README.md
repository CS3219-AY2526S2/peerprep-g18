[![Review Assignment Due Date](https://classroom.github.com/assets/deadline-readme-button-22041afd0340ce965d47ae6ef1cefeee28c7c493a6346c4f15d667ab976d596c.svg)](https://classroom.github.com/a/HpD0QZBI)
# CS3219 Project (PeerPrep) - AY2526S2
## Group: G18

## Group Members:
- [Lee Jia Quan, Benny](https://github.com/Shamanbenny)
- Kannan Annamalai
- Heng Yee Chong Fabian
- Subramanian Pon Harish
- Lee De En

## Roles and Responsibilities:
- M1: User Management - Heng Yee Chong Fabian
- M2: Peer Matching - Kannan Annamalai
- M3: Question Management - Subramanian Pon Harish
- M4: Collaboration - Lee De En
- M5: UI - Lee Jia Quan, Benny

For more information regarding the Product Backlog, refer to [our documentation here](docs/BACKLOG.md).

## Repo File Structure
```
peerprep-g18/
  README.md
  docs/
    images/
        ...
    README.md
    UML.md
    SCHEMA.md
    BACKLOG.md

  frontend/
    package.json
    src/
    .env.example
    Dockerfile

  backend/
    services/
      user-service/
        README.md   (what it does, how to run)
        src/
        package.json
        .env.example
        Dockerfile
      question-service/
        ...
      matching-service/
        ...
      collaboration-service/
        ...
      question-history-service/   (if implementing N2H as a service)
        ...
    libs/ (optional: shared types/utils; keep minimal to avoid coupling)

  deploy/
    compose.yaml (or docker-compose.yml)
    nginx/ (optional, if you add reverse proxy later)
```

### Note: 
- You are required to develop individual microservices within separate folders within this repository.
- The teaching team should be given access to the repositories, as we may require viewing the history of the repository in case of any disputes or disagreements. 
