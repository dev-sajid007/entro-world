# EntroWorld
## Production-Oriented Software Requirements Specification

**Project:** EntroWorld  
**Version:** 1.0.0  
**Status:** Development Planning  
**Product Type:** 3D Open World Social Network  
**Platform:** Web Browser  
**Graphics:** Realistic 3D  
**Multiplayer:** Massive Multiplayer (Distributed Architecture)  
**Primary Language:** TypeScript

---

# 1. Project Overview

EntroWorld is a browser-based 3D open-world social networking platform where users can interact with other people through realistic virtual environments.

Unlike traditional social media platforms, EntroWorld combines social networking with real-time multiplayer gaming environments.

Users can create their own avatars, explore a virtual city, communicate with other users, build virtual homes, attend events, share content, and participate in social activities.

The platform will provide a persistent social identity and an interactive 3D environment.

## 1.1 Core Vision

Build a persistent virtual city where people can:

- Meet other people.
- Explore a realistic 3D environment.
- Create personal identities and avatars.
- Share photos, videos, and posts.
- Communicate through text and voice.
- Build virtual properties.
- Create communities.
- Participate in virtual events.
- Play multiplayer mini-games.
- Discover other users and places.

## 1.2 Product Philosophy

EntroWorld is not just a multiplayer game.

It is a social network with a 3D world as its primary interface.

The platform must support both:

1. World-based social interaction.
2. Traditional social networking functionality.

---

# 2. Product Goals

## Primary Goals

1. Deliver a realistic browser-based 3D city.
2. Support real-time multiplayer interactions.
3. Provide persistent user profiles and social identities.
4. Build a scalable zone-based multiplayer architecture.
5. Integrate social networking features into the 3D world.
6. Support voice and text communication.
7. Allow users to customize their avatars and virtual spaces.
8. Provide moderation and administrative controls.

## Non-Goals for Initial Release

The following features are outside the initial MVP scope:

- VR headset support.
- Blockchain and NFT integration.
- Real-money virtual property trading.
- Fully destructible environments.
- Large-scale combat systems.
- Complex vehicle simulation.
- Native mobile applications.

These may be considered in future versions.

---

# 3. Technology Stack

## 3.1 Frontend

| Technology | Purpose |
|---|---|
| React | User interface |
| TypeScript | Application language |
| Three.js | 3D rendering |
| React Three Fiber | React integration for Three.js |
| Drei | 3D helpers and controls |
| Rapier | Physics and collision |
| React Router | Navigation |
| CSS Modules | UI styling |
| TanStack Query | API state management |

The 3D engine must be separated from the social UI.

The game world should not depend on the entire React component tree for every frame update.

## 3.2 Backend

| Technology | Purpose |
|---|---|
| Node.js | Runtime |
| TypeScript | Backend language |
| Fastify | HTTP API |
| Colyseus | Multiplayer framework |
| WebSocket | Real-time communication |
| Zod | Runtime validation |
| JWT | Authentication |

## 3.3 Database and Infrastructure

| Technology | Purpose |
|---|---|
| PostgreSQL | Persistent database |
| Drizzle ORM | Database access |
| Redis | Cache and presence |
| MinIO / S3 | Asset storage |
| Docker | Containerization |
| Nginx | Reverse proxy |
| BullMQ | Background jobs |
| LiveKit | Voice communication |

## 3.4 Monorepo

- pnpm
- Turborepo
- TypeScript project references where useful

---

# 4. System Architecture

EntroWorld will use a distributed client-server architecture.

## 4.1 High-Level Architecture

```text
                       INTERNET
                           |
                    NGINX / CDN
                           |
                +----------+----------+
                |                     |
            WEB CLIENT             API SERVER
                |                   Fastify
          React + Three.js             |
                |               +-----+------+
                |               |            |
          Colyseus Client     Auth        Social API
                |               |            |
          GAME GATEWAY          +------+-----+
                |                      |
         +------+-------+          PostgreSQL
         |      |       |              |
       Zone A Zone B  Zone C         Drizzle
         |      |       |
         +------+-------+
                |
              Redis
                |
        Presence / PubSub

         VOICE SERVICE
             |
           LiveKit

         OBJECT STORAGE
             |
          MinIO / S3
```

## 4.2 Architecture Principles

- Authoritative server architecture.
- Zone-based world partitioning.
- Server-side movement validation.
- Persistent user identity.
- Independent game and social services.
- Stateless HTTP API where possible.
- Real-time state synchronization.
- Horizontal game-server scaling.
- Asset streaming and level-of-detail rendering.
- Secure server-to-server communication.

## 4.3 Client Architecture

The client will have separate subsystems.

```text
Client
├── Application
│   ├── Router
│   ├── Authentication
│   └── UI
│
├── Game
│   ├── GameEngine
│   ├── SceneManager
│   ├── CameraController
│   ├── InputManager
│   ├── PhysicsManager
│   ├── WorldManager
│   ├── PlayerController
│   ├── AvatarManager
│   └── AssetManager
│
├── Multiplayer
│   ├── NetworkClient
│   ├── RoomManager
│   ├── PlayerSynchronizer
│   └── Reconciliation
│
└── Social
    ├── Chat
    ├── Friends
    ├── Notifications
    └── Profile
```

The game loop must use requestAnimationFrame through the rendering engine.

Do not trigger React state updates on every animation frame.

---

# 5. Open World Design

## 5.1 World Type

Modern realistic metropolitan city.

The world should contain:

- Streets.
- Roads.
- Buildings.
- Apartments.
- Parks.
- Shops.
- Restaurants.
- Public squares.
- Beaches or waterfront areas.
- Event centers.
- Social gathering locations.

## 5.2 World Zones

The city will be divided into logical zones.

Initial zones:

| Zone ID | Name | Description |
|---|---|---|
| zone-central | Central Plaza | Main social hub |
| zone-business | Business District | Commercial buildings |
| zone-residential | Residential Area | Houses and apartments |
| zone-park | City Park | Social activities |
| zone-beach | Waterfront | Relaxation and events |
| zone-event | Event Center | Live events |

Each zone can contain multiple multiplayer rooms.

## 5.3 World Coordinate System

Use a consistent world coordinate system.

- X: Horizontal position.
- Y: Vertical position.
- Z: Depth.

Use meters as the logical world unit.

Example:

```ts
interface Vector3 {
  x: number;
  y: number;
  z: number;
}

interface WorldPosition {
  zoneId: string;
  position: Vector3;
  rotation: number;
}
```

## 5.4 World Streaming

The client should not load the entire city at once.

Requirements:

- Load nearby environment chunks.
- Unload distant chunks.
- Load assets asynchronously.
- Use LOD for distant objects.
- Use instancing for repeated objects.
- Use optimized collision meshes.
- Support compressed textures and 3D assets.

---

# 6. Avatar System

Each user must have a persistent avatar.

## Features

- Avatar creation.
- Gender-neutral avatar options.
- Skin customization.
- Hair customization.
- Clothing.
- Accessories.
- Animation states.
- Emotes.
- Avatar preview.

## Avatar Animation States

```text
IDLE
WALKING
RUNNING
JUMPING
FALLING
SITTING
EMOTING
```

## Avatar Data

```ts
interface AvatarConfig {
  modelId: string;

  appearance: {
    skinTone: string;
    hairStyle: string;
    hairColor: string;
  };

  clothing: {
    top: string;
    bottom: string;
    shoes: string;
  };

  accessories: string[];
}
```

The client renders avatar assets, but the server validates movement and interaction.

---

# 7. Multiplayer System

## 7.1 Architecture

Use Colyseus for real-time multiplayer room management.

The game server is authoritative.

Clients send movement inputs, not trusted world positions.

Example:

```ts
interface PlayerInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
}
```

The server processes input and calculates valid movement.

## 7.2 Room System

Each room represents a multiplayer instance of a world zone.

Example:

```text
Central Plaza
├── Room 001
├── Room 002
├── Room 003
└── Room 004
```

Initial development capacity:

- 2-5 players for local testing.
- 10-20 players for initial multiplayer testing.
- 50-100 players per room as a future optimization target.

These are targets, not guaranteed capacities.

Actual capacity depends on hardware, tick rate, state size, network bandwidth, and simulation complexity.

## 7.3 Massive Multiplayer Strategy

Massive multiplayer must be achieved through distributed zones and multiple rooms.

Requirements:

- Multiple game-server processes.
- Room allocation service.
- Zone-based routing.
- Redis-backed presence.
- Server discovery.
- Health checks.
- Graceful room shutdown.
- Automatic reconnection.
- Load-aware room allocation.
- Cross-zone transitions.

Do not assume Redis alone automatically provides distributed Colyseus room state. Implement and verify the chosen driver, presence, matchmaking, and room-discovery configuration.

## 7.4 Network Optimization

Requirements:

- Delta state synchronization where supported.
- Interest management.
- Nearby-player visibility.
- Interpolation.
- Client-side prediction.
- Server reconciliation.
- Message rate limiting.
- Connection heartbeat.
- Reconnection support.

Target initial simulation configuration:

- Server simulation: 20 ticks per second.
- Client rendering: 60 FPS target.
- Position synchronization: adaptive.
- Network interpolation: configurable.

These values must be benchmarked before production.

---

# 8. Social Networking Features

## 8.1 User Profile

Each user has:

- Username.
- Display name.
- Profile photo.
- Avatar.
- Biography.
- Location in virtual world.
- Online status.
- Friends.
- Posts.
- Followers.
- Following.

## 8.2 Posts

Users can create:

- Text posts.
- Image posts.
- Video posts.
- World location posts.
- Event announcements.

Posts must be accessible from both the normal social feed and relevant 3D locations.

## 8.3 Reactions

- Like.
- Comment.
- Share.
- Save.
- Report.

## 8.4 Friend System

- Send friend request.
- Accept request.
- Reject request.
- Remove friend.
- Block user.
- Online friends.
- Join friend's world where permitted.

## 8.5 Direct Messaging

- One-to-one messaging.
- Group messaging.
- Message history.
- Read receipts.
- Typing indicators.
- Online status.

## 8.6 Notifications

- Friend requests.
- New messages.
- Likes.
- Comments.
- Mentions.
- Event invitations.
- Friend online notifications.

---

# 9. Real-Time Communication

## 9.1 Text Chat

Support:

- Global chat.
- Local zone chat.
- Room chat.
- Private messages.
- Group chat.

## 9.2 Proximity Voice Chat

Use LiveKit or WebRTC-based infrastructure.

Voice requirements:

- Proximity-based communication.
- Mute and unmute.
- Microphone permissions.
- Private voice rooms.
- Group voice rooms.
- Voice moderation controls.

The game server determines the permitted communication group based on authoritative player location.

Voice streams must not be routed through the main game-state synchronization loop.

---

# 10. Virtual Property and Activities

Future features:

- Personal virtual houses.
- Apartment ownership.
- Interior customization.
- Furniture.
- Decorations.
- Personal galleries.
- Virtual shops.
- Community spaces.
- Mini-games.
- Events.
- Interactive objects.

All ownership and inventory operations must be validated server-side.

Real-money purchases must use a separate secure payment workflow.

---

# 11. Database Design

Database: PostgreSQL

ORM: Drizzle

## 11.1 Main Entities

### Users

- id
- email
- username
- password_hash
- display_name
- status
- created_at
- updated_at

### Profiles

- id
- user_id
- bio
- avatar_url
- cover_url
- privacy
- created_at

### Avatars

- id
- user_id
- model_id
- appearance
- clothing
- accessories
- updated_at

### World Zones

- id
- name
- slug
- world_id
- metadata
- is_active

### World Instances

- id
- zone_id
- room_id
- server_id
- status
- current_players
- created_at

### Posts

- id
- user_id
- content
- visibility
- post_type
- created_at
- updated_at

### Post Media

- id
- post_id
- media_url
- media_type
- metadata

### Comments

- id
- post_id
- user_id
- content
- created_at

### Reactions

- id
- post_id
- user_id
- reaction_type
- created_at

### Friendships

- id
- requester_id
- addressee_id
- status
- created_at
- updated_at

### Conversations

- id
- conversation_type
- created_at

### Conversation Members

- id
- conversation_id
- user_id
- joined_at

### Messages

- id
- conversation_id
- sender_id
- content
- message_type
- created_at
- edited_at

### Notifications

- id
- user_id
- actor_id
- notification_type
- reference_id
- is_read
- created_at

### User World State

- user_id
- zone_id
- position_x
- position_y
- position_z
- rotation
- updated_at

### User Inventory

- id
- user_id
- item_id
- quantity
- metadata

### Virtual Properties

- id
- owner_id
- property_type
- zone_id
- position
- configuration
- created_at

### Moderation Reports

- id
- reporter_id
- target_user_id
- target_content_id
- reason
- status
- created_at

## 11.2 Database ERD

```mermaid
erDiagram
    USERS ||--|| PROFILES : has
    USERS ||--|| AVATARS : owns
    USERS ||--o{ POSTS : creates
    USERS ||--o{ COMMENTS : writes
    USERS ||--o{ REACTIONS : reacts
    USERS ||--o{ FRIENDSHIPS : participates
    USERS ||--o{ MESSAGES : sends
    USERS ||--o{ NOTIFICATIONS : receives
    USERS ||--o| USER_WORLD_STATE : occupies
    USERS ||--o{ USER_INVENTORY : owns
    USERS ||--o{ VIRTUAL_PROPERTIES : owns

    POSTS ||--o{ POST_MEDIA : contains
    POSTS ||--o{ COMMENTS : has
    POSTS ||--o{ REACTIONS : receives

    CONVERSATIONS ||--o{ MESSAGES : contains
    CONVERSATIONS ||--o{ CONVERSATION_MEMBERS : includes
    USERS ||--o{ CONVERSATION_MEMBERS : joins

    WORLD_ZONES ||--o{ WORLD_INSTANCES : hosts
    WORLD_ZONES ||--o{ USER_WORLD_STATE : contains
    WORLD_ZONES ||--o{ VIRTUAL_PROPERTIES : contains

    USERS {
        uuid id PK
        varchar email UK
        varchar username UK
        varchar password_hash
        varchar display_name
        varchar status
        timestamp created_at
    }

    PROFILES {
        uuid id PK
        uuid user_id FK
        text bio
        varchar avatar_url
        varchar privacy
    }

    AVATARS {
        uuid id PK
        uuid user_id FK
        varchar model_id
        jsonb appearance
        jsonb clothing
    }

    POSTS {
        uuid id PK
        uuid user_id FK
        text content
        varchar post_type
        varchar visibility
        timestamp created_at
    }

    WORLD_ZONES {
        uuid id PK
        varchar name
        varchar slug
        uuid world_id
    }

    WORLD_INSTANCES {
        uuid id PK
        uuid zone_id FK
        varchar room_id
        varchar server_id
        varchar status
    }

    USER_WORLD_STATE {
        uuid user_id PK
        uuid zone_id FK
        float position_x
        float position_y
        float position_z
        timestamp updated_at
    }
```

## 11.3 Database Rules

- Use UUID primary keys.
- Use foreign-key constraints.
- Add indexes to frequently queried columns.
- Enforce unique usernames and emails.
- Use transactions for multi-step social operations.
- Use soft deletion where appropriate.
- Store media in object storage, not PostgreSQL binary columns.
- Use JSONB for flexible avatar and world configuration.
- Never store every frame of player movement in PostgreSQL.
- Persist important world state periodically and on controlled transitions.

---

# 12. API Design

Base URL:

```text
/api/v1
```

## Authentication

```http
POST /auth/register
POST /auth/login
POST /auth/logout
POST /auth/refresh
GET  /auth/me
```

## Users

```http
GET    /users/:username
PATCH  /users/me
GET    /users/:id/profile
GET    /users/:id/friends
GET    /users/search
```

## Posts

```http
POST   /posts
GET    /posts/feed
GET    /posts/:id
PATCH  /posts/:id
DELETE /posts/:id
POST   /posts/:id/reactions
POST   /posts/:id/comments
GET    /posts/:id/comments
```

## Friends

```http
POST   /friends/requests
GET    /friends/requests
POST   /friends/requests/:id/accept
POST   /friends/requests/:id/reject
DELETE /friends/:id
POST   /users/:id/block
```

## World

```http
GET  /worlds
GET  /worlds/:id/zones
GET  /worlds/zones/:id
POST /worlds/join
POST /worlds/leave
GET  /worlds/instances
```

The join endpoint should return an authorized room connection ticket or equivalent short-lived connection credentials.

## Messaging

```http
GET  /conversations
POST /conversations
GET  /conversations/:id/messages
POST /conversations/:id/messages
```

All APIs must include authentication, validation, authorization, and rate limiting.

---

# 13. Security Requirements

Security is mandatory from the first development milestone.

## Authentication

- Secure password hashing using Argon2id.
- Short-lived access tokens.
- Refresh token rotation.
- Secure cookie strategy where applicable.
- Session revocation.
- Email verification.

## Multiplayer Security

- Server-authoritative movement.
- Input validation.
- Movement speed limits.
- Teleport detection.
- Message rate limiting.
- Room authorization.
- Server-side interaction validation.
- Connection abuse protection.

## Social Security

- Block and report systems.
- Content moderation.
- Spam protection.
- Privacy settings.
- Authorization checks.
- Upload validation.
- Secure media URLs.

## Infrastructure Security

- HTTPS only.
- Environment-based secrets.
- Database access restrictions.
- Redis authentication and private networking.
- CORS allowlist.
- Request limits.
- Structured audit logs.
- Regular backups.

---

# 14. Performance Requirements

These are engineering targets to validate through load testing, not launch guarantees.

| Metric | Initial Target |
|---|---|
| Client rendering | 60 FPS target |
| Minimum supported rendering | 30 FPS |
| Server simulation | 20 ticks/sec |
| API response | p95 under 300ms |
| Nearby player updates | Adaptive |
| Initial world load | Under 10 seconds on supported connections |
| Multiplayer test | 10-20 users |
| Future room target | 50-100 users |

Performance optimization:

- Frustum culling.
- Occlusion strategies.
- LOD.
- Instanced meshes.
- Texture compression.
- Asset caching.
- Lazy loading.
- Network interest management.
- Efficient state schemas.
- Database query optimization.

---

# 15. Observability and Operations

Production services must expose:

- Health endpoints.
- Readiness endpoints.
- Structured JSON logs.
- Error tracking.
- API latency metrics.
- Game room occupancy.
- Active connections.
- Server tick duration.
- Network traffic.
- Memory and CPU utilization.

Recommended monitoring stack:

- Prometheus.
- Grafana.
- OpenTelemetry.
- Sentry.

Game servers should support graceful shutdown and room draining before termination.

---

# 16. Admin Dashboard

The administration system should provide:

## User Management

- View users.
- Suspend users.
- Ban users.
- Review user profiles.
- View moderation history.

## World Management

- Manage zones.
- Manage rooms.
- Monitor active players.
- Inspect server health.
- Configure world events.

## Content Moderation

- Review reports.
- Remove content.
- Moderate messages.
- Investigate abuse.

## Analytics

- Daily active users.
- Monthly active users.
- Concurrent users.
- Average session duration.
- Popular zones.
- Social engagement.

---

# 17. Monorepo Project Structure

```text
entroworld/
│
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── components/
│   │   │   ├── features/
│   │   │   │   ├── auth/
│   │   │   │   ├── profile/
│   │   │   │   ├── social/
│   │   │   │   └── world/
│   │   │   ├── game/
│   │   │   │   ├── core/
│   │   │   │   ├── scenes/
│   │   │   │   ├── camera/
│   │   │   │   ├── controls/
│   │   │   │   ├── physics/
│   │   │   │   ├── entities/
│   │   │   │   └── assets/
│   │   │   └── main.tsx
│   │   └── package.json
│   │
│   ├── api/
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── users/
│   │   │   │   ├── posts/
│   │   │   │   ├── friends/
│   │   │   │   ├── messages/
│   │   │   │   └── worlds/
│   │   │   ├── plugins/
│   │   │   ├── middleware/
│   │   │   └── server.ts
│   │   └── package.json
│   │
│   ├── game-server/
│   │   ├── src/
│   │   │   ├── rooms/
│   │   │   ├── schemas/
│   │   │   ├── systems/
│   │   │   ├── matchmaking/
│   │   │   ├── movement/
│   │   │   ├── zones/
│   │   │   └── server.ts
│   │   └── package.json
│   │
│   └── admin/
│       ├── src/
│       └── package.json
│
├── packages/
│   ├── shared/
│   ├── database/
│   ├── game-engine/
│   ├── game-protocol/
│   ├── avatar/
│   ├── world-assets/
│   ├── validation/
│   └── config/
│
├── infra/
│   ├── docker/
│   ├── nginx/
│   ├── monitoring/
│   └── scripts/
│
├── docs/
│   ├── architecture.md
│   ├── database.md
│   ├── api.md
│   └── multiplayer.md
│
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
├── .env.example
└── SPEC.md
```

---

# 18. Development Milestones

## Milestone 01 — 3D World Foundation

Goal: Create the first playable 3D city environment.

Tasks:

- Initialize pnpm monorepo.
- Create React + TypeScript application.
- Configure Three.js / React Three Fiber.
- Create realistic 3D ground.
- Build a simple city block.
- Add buildings and roads.
- Implement third-person camera.
- Implement WASD movement.
- Implement mouse camera controls.
- Add jump and sprint.
- Add physics and collision detection.
- Implement responsive game UI.
- Optimize initial rendering.

Acceptance Criteria:

- Application runs in a browser.
- Player can move around the environment.
- Camera follows the player.
- Player cannot walk through solid obstacles.
- No major frame drops in the initial test scene.
- Game engine is modular and extensible.

## Milestone 02 — Multiplayer Foundation

Tasks:

- Set up Colyseus server.
- Create player schema.
- Implement room creation.
- Implement player joining and leaving.
- Synchronize movement.
- Add player names.
- Add network interpolation.
- Add reconnection handling.

Acceptance Criteria:

- At least two browser clients can enter the same room.
- Each player sees the other.
- Movement synchronizes.
- Server rejects invalid movement.

## Milestone 03 — Authentication and Social Backend

Tasks:

- PostgreSQL setup.
- Drizzle ORM.
- User registration.
- Login and logout.
- Profile management.
- Avatar persistence.
- Friends.
- Posts.
- Comments.
- Reactions.

## Milestone 04 — Real-Time Communication

Tasks:

- Text chat.
- Room chat.
- Private messages.
- Proximity voice.
- LiveKit integration.
- Notification system.

## Milestone 05 — Persistent Virtual City

Tasks:

- World zones.
- Zone transitions.
- Personal properties.
- Avatar customization.
- Inventory.
- Interactive objects.
- Events.

## Milestone 06 — Massive Multiplayer Infrastructure

Tasks:

- Multiple game-server processes.
- Distributed room allocation.
- Redis-backed presence.
- Cross-zone transitions.
- Load testing.
- Auto-scaling strategy.
- Monitoring.
- Failure recovery.

## Milestone 07 — Production Release

Tasks:

- Admin dashboard.
- Moderation.
- Security audit.
- Performance profiling.
- Browser compatibility.
- Backup strategy.
- CI/CD.
- Production deployment.

---

# 19. Testing Strategy

## Unit Tests

- Movement validation.
- Avatar configuration.
- Input validation.
- Permission checks.
- Social business logic.

## Integration Tests

- Authentication API.
- Database operations.
- Friendship workflows.
- Room lifecycle.
- Chat delivery.

## Multiplayer Tests

- Multiple clients joining a room.
- Movement synchronization.
- Invalid input rejection.
- Disconnect and reconnect.
- Room shutdown.
- Network latency simulation.

## Load Tests

Measure:

- Concurrent connections.
- Server tick duration.
- CPU utilization.
- Memory usage.
- Bandwidth.
- Room capacity.

Do not advertise a maximum player capacity until it has been demonstrated through reproducible load tests.

---

# 20. Deployment Strategy

Initial infrastructure:

```text
Internet
   |
Cloudflare
   |
Nginx
   |
   +---- Web Client
   |
   +---- API Server
   |
   +---- Game Server
   |
   +---- PostgreSQL
   |
   +---- Redis
   |
   +---- MinIO
```

Development environment:

- Docker Compose.
- Local PostgreSQL.
- Local Redis.
- Local game server.
- Vite development server.

Production environment:

- Linux VPS.
- Docker containers.
- Nginx reverse proxy.
- TLS.
- PostgreSQL backups.
- Redis persistence where required.
- Object storage.
- Monitoring.

The infrastructure should eventually support independent game-server deployments and horizontal scaling.

---

# 21. Environment Variables

Example `.env.example`:

```env
NODE_ENV=development

WEB_URL=http://localhost:5173
API_PORT=3001
GAME_PORT=2567

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/entroworld

REDIS_URL=redis://localhost:6379

JWT_ACCESS_SECRET=replace_me
JWT_REFRESH_SECRET=replace_me

S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minio
S3_SECRET_KEY=replace_me
S3_BUCKET=entroworld

LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

Never commit actual secrets to Git.

---

# 22. Engineering Rules

1. Use TypeScript strict mode.
2. Use ESM modules.
3. Prefer modular architecture.
4. Keep game engine independent from social UI.
5. Avoid unnecessary dependencies.
6. Use Zod for external input validation.
7. Use Drizzle migrations.
8. Never trust client-side game state.
9. Never store frame-by-frame movement in PostgreSQL.
10. Keep shared interfaces inside packages/shared or game-protocol.
11. Write tests for critical game and social logic.
12. Document important architectural decisions.
13. Optimize based on profiling rather than assumptions.
14. Keep all infrastructure configuration version-controlled.
15. Every milestone must have testable acceptance criteria.

---

# 23. MVP Definition

The first public MVP should include:

- User registration and login.
- Basic avatar.
- Realistic 3D city.
- Third-person movement.
- Multiplayer room.
- Player visibility.
- Text chat.
- User profiles.
- Basic friend system.
- Basic moderation.

The MVP does not need the entire city, hundreds of players, personal property ownership, or voice communication.

The first objective is to prove that a 3D world can function as a social network.

---

# 24. Future Roadmap

Potential future additions:

- AI-powered NPCs.
- AI social companions.
- User-created virtual worlds.
- World editor.
- Virtual businesses.
- Live concerts.
- Educational spaces.
- Virtual conferences.
- Marketplace.
- Creator economy.
- Custom avatar marketplace.
- Advanced vehicle systems.
- VR support.
- Mobile support.

---

# 25. Definition of Success

EntroWorld will be considered technically successful when:

1. Users can register and create persistent identities.
2. Users can enter and explore a realistic 3D city.
3. Multiple users can interact in real time.
4. Social networking features work independently of the game renderer.
5. Server-side validation prevents basic movement manipulation.
6. The world supports multiple independent zones.
7. Game servers can be scaled horizontally.
8. Core services have monitoring and recovery procedures.
9. The browser experience remains performant on supported hardware.

---

# 26. Immediate Development Priority

**Start with Milestone 01.**

Do not build the entire social platform before proving the 3D world.

First deliver:

- A working 3D city.
- A controllable third-person player.
- A follow camera.
- Realistic lighting.
- Buildings and roads.
- Physics and collisions.
- A clean, modular game engine.

After Milestone 01 is stable, integrate Colyseus for multiplayer.

**Project Principle: Build the world first, connect the people second, and scale the universe third.**

---

**End of Specification**

Project: EntroWorld  
Document: SPEC.md  
Version: 1.0.0