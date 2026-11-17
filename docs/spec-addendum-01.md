# EntroWorld — Feature Specification Addendum
## Coding Academy & AI Agent Marketplace

**Project:** EntroWorld
**Document:** SPEC-ADDENDUM-01
**Extends:** SPEC.md v1.0.0
**Version:** 0.1.0 (Draft)
**Status:** Planning
**Depends on:** Milestone 01 (3D World), Milestone 02 (Multiplayer), Milestone 03 (Auth & Social Backend)

---

# 1. Overview

This addendum defines two new feature areas for EntroWorld:

1. **Coding Academy** — an in-world learning zone where users learn programming by writing code that visibly affects the 3D world.
2. **AI Agent Marketplace** — a district of shops, each staffed by an AI agent NPC that users can talk to via text or voice, and whose AI products users can try and purchase.

Both features follow the core SPEC principles: authoritative server, never trusting the client, separation of game engine and social UI, and independent services.

## 1.1 Why These Features

- They give users a **reason to return** beyond socializing: learning progress and useful AI tools.
- They turn the 3D world into a **functional interface**, not only a decorative one.
- They connect directly to existing social systems (profiles, posts, friends, events).
- The AI Marketplace creates a **revenue path** (shop rental, agent subscriptions) without blockchain or real-money property trading, which remain non-goals.

## 1.2 Non-Goals for This Addendum

- Running user-written code on any server.
- Full general-purpose IDE or arbitrary package installation.
- AI agents that perform real-world actions (payments, email, external accounts) on behalf of users.
- Open third-party agent publishing without review (deferred to a later phase).
- AI-generated 3D assets at runtime.

---

# 2. New World Zones

Add to SPEC §5.2 World Zones:

| Zone ID | Name | Description |
|---|---|---|
| zone-academy | Coding Academy | Classrooms, puzzle labs, challenge arena |
| zone-market | AI Agent Street | Shops staffed by AI agent NPCs |

Both zones use the standard room system (SPEC §7.2). Puzzle labs may also use **private single-player or small-group instances** so puzzle state does not conflict between users.

---

# PART A — CODING ACADEMY

# 3. Feature Description

Users enter the Academy, pick a learning track, and solve puzzles by programming an in-world entity (a robot companion). Code runs in a sandbox in the browser; its effects are shown immediately in 3D. Completion is validated by the server.

## 3.1 Learning Levels

| Level | Editor | Target User |
|---|---|---|
| Beginner | Block-based (Blockly), drag-and-drop | No prior coding experience |
| Intermediate | Split view: blocks + generated JavaScript | Transitioning to text code |
| Advanced | Text editor (Monaco), JavaScript / TypeScript subset | Comfortable with syntax |

## 3.2 Curriculum (Initial Track: "Programming Basics")

| Lesson | Concept | Example Puzzle |
|---|---|---|
| 1 | Sequences | Move the robot to the door |
| 2 | Loops | Walk around the fountain using `repeat` |
| 3 | Conditions | Avoid obstacles with `if` |
| 4 | Variables | Count collected coins |
| 5 | Functions | Build a reusable `buildBridge()` |
| 6 | Events | React when a player steps on a tile |
| 7 | Arrays | Light lamps in a sequence |
| 8 | Final challenge | Combine all concepts to open the vault |

Curriculum content must be data-driven (stored as lesson definitions), not hard-coded, so new tracks can be added without client releases.

## 3.3 Core Features

### Robot Companion
- Each user gets a programmable robot in the Academy.
- Robot exposes a limited, documented API.
- Robot actions are animated in 3D.

### Puzzle Rooms
- Each puzzle has a start state, goal condition, and allowed API.
- Puzzle success unlocks world effects (doors open, bridges appear).
- Hints are available progressively.

### Progress & Rewards
- XP per completed lesson.
- Badges shown on user profile.
- Learning streaks.
- Optional shareable completion posts (SPEC §8.2).

### AI Tutor NPC
- Available in the Academy; implemented via the AI Agent Service (Part B).
- Gives **hints, not solutions** by default.
- Has access to the current puzzle definition and the user's current code (with consent).

### Multiplayer Learning
- **Pair programming:** two users share one editor session in a puzzle room.
- **Live classes:** teachers present code on a world screen in the Event Center.
- **Coding battles:** two users race to solve the same puzzle.
- **Study groups:** friend-based groups with shared progress.

### Creator Mode (Later Phase)
- Users who complete tracks can script interactive objects in their own spaces.
- Scripts use the same sandbox and API model.

---

# 4. Code Execution Model

## 4.1 Principle

**User code never runs on EntroWorld servers.** User code runs only inside a client-side sandbox. The server validates outcomes, not code.

## 4.2 Sandbox

| Option | Use |
|---|---|
| Web Worker + restricted globals | Initial implementation |
| QuickJS compiled to WASM | Preferred for strict isolation and step limits |

Sandbox requirements:

- No access to DOM, `window`, `fetch`, `WebSocket`, `localStorage`, or cookies.
- No access to other users' data.
- Only the injected robot/world API is available.
- Execution time limit (e.g. 2 seconds wall time per run).
- Instruction / step limit to stop infinite loops.
- Memory limit.
- Sandbox is terminated and recreated on violation.

## 4.3 Robot API (Example)

```ts
interface RobotAPI {
  moveForward(steps: number): void;
  turnLeft(): void;
  turnRight(): void;
  jump(): void;
  pickUp(): boolean;
  drop(): void;
  isPathClear(): boolean;
  sensor(name: 'front' | 'left' | 'right'): 'empty' | 'wall' | 'item';
  say(text: string): void;
}
```

Each puzzle declares which API methods are allowed.

## 4.4 Execution Flow

```text
User writes code (Blockly / Monaco)
        |
        v
Sandbox runs code against a LOCAL deterministic simulation
        |
        v
Sandbox produces an ACTION LOG
  [moveForward(2), turnLeft(), pickUp(), ...]
        |
        +--> Client animates the robot in 3D
        |
        v
Client submits action log to API
        |
        v
Server replays action log against the SAME deterministic
puzzle simulation (packages/puzzle-engine)
        |
        v
Goal reached? -> record completion, grant XP, unlock world effect
```

The puzzle simulation must be **deterministic** and shared between client and server via a package, so the server can replay and verify without executing user code.

## 4.5 Anti-Cheat

- Server replays the action log; client-reported "success" is ignored.
- Action logs have a maximum length per puzzle.
- Rate-limit submissions per user per puzzle.
- XP grants are idempotent per lesson.

---

# 5. Academy Data Model

Add to SPEC §11.

### Learning Tracks
- id
- slug
- title
- description
- level (beginner | intermediate | advanced)
- order_index
- is_published

### Lessons
- id
- track_id
- slug
- title
- content (JSONB: instructions, hints)
- puzzle_definition (JSONB: map, start state, goal, allowed_api, max_actions)
- xp_reward
- order_index

### Lesson Progress
- id
- user_id
- lesson_id
- status (not_started | in_progress | completed)
- attempts
- best_action_count
- last_code (text, optional, user-controlled)
- completed_at
- updated_at

### Badges
- id
- slug
- name
- description
- icon_url
- criteria (JSONB)

### User Badges
- id
- user_id
- badge_id
- awarded_at

### User Learning Stats
- user_id (PK)
- total_xp
- level
- current_streak
- longest_streak
- last_activity_date

Rules:

- Unique constraint on (user_id, lesson_id) in Lesson Progress.
- Unique constraint on (user_id, badge_id) in User Badges.
- XP and badge grants happen in a single transaction with completion.

---

# 6. Academy API

```http
GET    /academy/tracks
GET    /academy/tracks/:slug
GET    /academy/lessons/:id
GET    /academy/progress/me
POST   /academy/lessons/:id/attempts      # submit action log for verification
PUT    /academy/lessons/:id/code          # save draft code (optional)
GET    /academy/badges/me
GET    /academy/leaderboard               # weekly XP, friends / global
POST   /academy/sessions                  # create pair-programming session
POST   /academy/sessions/:id/join
```

Attempt request (validated with Zod):

```ts
interface LessonAttemptRequest {
  lessonId: string;
  actions: RobotAction[];
  editorMode: 'blocks' | 'split' | 'code';
}

type RobotAction =
  | { type: 'moveForward'; steps: number }
  | { type: 'turnLeft' }
  | { type: 'turnRight' }
  | { type: 'jump' }
  | { type: 'pickUp' }
  | { type: 'drop' }
  | { type: 'say'; text: string };
```

Attempt response:

```ts
interface LessonAttemptResponse {
  success: boolean;
  failureReason?: 'goal_not_reached' | 'invalid_action' | 'too_many_actions';
  xpAwarded: number;
  badgesAwarded: string[];
  worldEffects: string[]; // e.g. ['door-academy-03-open']
}
```

---

# 7. Multiplayer Integration (Academy)

- Pair-programming editor sync uses a separate collaborative channel (e.g. Yjs over WebSocket), **not** the game-state tick loop.
- Robot animations in shared rooms are broadcast as action sequences, not per-frame positions.
- World effects (door opened) are applied by the game server after API confirmation, using a server-to-server event (Redis pub/sub).

---

# 8. Academy Frontend Structure

```text
apps/web/src/features/academy/
├── editor/
│   ├── BlocklyEditor.tsx
│   ├── MonacoEditor.tsx
│   └── SplitEditor.tsx
├── sandbox/
│   ├── sandboxWorker.ts
│   └── SandboxRunner.ts
├── lessons/
├── progress/
└── tutor/

packages/puzzle-engine/       # deterministic simulation, shared client/server
packages/robot-api/           # API definitions + action types
```

---

# PART B — AI AGENT MARKETPLACE

# 9. Feature Description

AI Agent Street is a district of shops. Each shop is staffed by an AI shopkeeper NPC with its own name, personality, voice, and specialty. Users walk in, talk to the shopkeeper by text or voice, try its AI product, and may subscribe or purchase usage.

## 9.1 Initial Shops

| Shop | AI Agent Role | Product |
|---|---|---|
| Code Corner | Coding mentor | Code help, explanations (also powers Academy tutor) |
| Design Studio | Creative assistant | Logo, poster, and color ideas |
| Book Café | Librarian | Book recommendations, story summaries |
| Language School | Conversation partner | Language practice |
| Career Office | Career coach | CV review, mock interviews |
| Travel Agency | Travel planner | Trip planning |
| Wellness Corner | Wellness guide | General fitness tips (non-medical, with disclaimer) |

## 9.2 Core Features

### Shopkeeper NPC
- Greets users who enter the shop's trigger area.
- Idle, talking, listening, and gesture animations.
- Lip-sync or mouth animation during speech.
- Clearly labeled as AI (nameplate badge "AI").

### Conversation
- Text chat panel.
- Voice conversation (push-to-talk initially).
- Optional per-user memory, opt-in, deletable.
- Conversation history per shop.

### Products
- 3D product displays on shelves; clicking opens a detail panel.
- Free trial quota per product.
- Paid plans or usage credits (future, via separate secure payment workflow, SPEC §10).
- Ratings and reviews.

### Social Integration
- Group conversation: friends in the same shop can join one conversation.
- Share a conversation result as a post (user chooses what to share).
- Popular shops highlighted on the world map.
- Shop events (e.g. "Mock interview day" in Career Office).

### Shop Ownership (Later Phase)
- Approved partners rent a shop and configure their own agent.
- Mandatory review, content policy, and monitoring before publishing.

---

# 10. AI Agent Architecture

## 10.1 New Service

Add a new independent service: **`apps/ai-agent-service`**.

```text
        WEB CLIENT
            |
   text  ---+---  voice
            |         \
        API SERVER    LIVEKIT
     (auth, limits)      |
            |        LiveKit Agent Worker
            |        (STT -> LLM -> TTS)
            |            |
            +-----+------+
                  |
          AI AGENT SERVICE
          ├── Agent Registry
          ├── Prompt Builder
          ├── Conversation Manager
          ├── Safety / Moderation
          ├── Usage & Quota
          └── LLM Provider Adapter
                  |
        +---------+----------+
        |                    |
   LLM Provider         PostgreSQL / Redis
 (e.g. Claude API)     (configs, history, quotas)
```

## 10.2 Responsibilities

| Component | Responsibility |
|---|---|
| Agent Registry | Load agent configs (prompt, personality, voice, tools, limits) |
| Prompt Builder | Combine system prompt, shop context, user memory, safety rules |
| Conversation Manager | Store and trim history, manage context window |
| Safety / Moderation | Filter input and output, detect prompt injection, enforce policy |
| Usage & Quota | Per-user and per-agent rate limits and token budgets |
| LLM Provider Adapter | Abstract provider so models can be swapped |

## 10.3 Game Server Role

- Shopkeeper NPCs are ordinary entities in the zone room schema.
- The game server only syncs NPC position and **animation state** (`idle`, `listening`, `talking`).
- The game server does **not** call the LLM. All AI calls go through the AI Agent Service, so slow LLM responses never block the simulation tick.
- When a user enters a shop's trigger volume, the game server emits an event; the client opens the conversation UI.

## 10.4 Voice Pipeline

- Use LiveKit (already in SPEC §3.3) with an agent worker.
- Pipeline: speech-to-text → AI Agent Service → text-to-speech → audio track back to user.
- Voice is never routed through the game-state loop (SPEC §9.2).
- Streaming responses to reduce perceived latency.

## 10.5 Streaming

Text responses stream to the client via Server-Sent Events or WebSocket so the shopkeeper starts "talking" before the full answer is ready.

---

# 11. AI Marketplace Data Model

Add to SPEC §11.

### Shops
- id
- zone_id
- slug
- name
- description
- position (JSONB)
- interior_config (JSONB)
- owner_type (platform | partner)
- owner_id (nullable)
- status (draft | in_review | active | suspended)
- created_at

### AI Agents
- id
- shop_id
- name
- persona (JSONB: personality, greeting, speaking style)
- system_prompt (text, server-only)
- model_config (JSONB: provider, model, temperature, max_tokens)
- voice_config (JSONB)
- allowed_tools (JSONB)
- safety_profile (varchar)
- version
- is_active
- updated_at

### AI Products
- id
- agent_id
- name
- description
- product_type (chat | tool | subscription)
- free_quota (integer)
- price_config (JSONB)
- is_active

### Agent Conversations
- id
- agent_id
- user_id
- is_group
- memory_enabled
- created_at
- last_message_at
- deleted_at

### Agent Conversation Members
- id
- conversation_id
- user_id
- joined_at

### Agent Messages
- id
- conversation_id
- sender_type (user | agent | system)
- sender_user_id (nullable)
- content
- token_count
- moderation_status (ok | flagged | blocked)
- created_at

### Agent User Memory
- id
- agent_id
- user_id
- memory (JSONB)
- updated_at

### Agent Usage
- id
- user_id
- agent_id
- product_id
- period_start
- requests
- input_tokens
- output_tokens

### Product Reviews
- id
- product_id
- user_id
- rating (1–5)
- content
- created_at

Rules:

- `system_prompt` is never returned to clients.
- Unique (agent_id, user_id) on Agent User Memory.
- Unique (product_id, user_id) on Product Reviews.
- Soft delete conversations; hard-delete on user data deletion request.

---

# 12. AI Marketplace API

```http
GET    /market/shops
GET    /market/shops/:slug
GET    /market/shops/:slug/products
GET    /market/agents/:id                     # public persona only

POST   /market/agents/:id/conversations
GET    /market/conversations
GET    /market/conversations/:id/messages
POST   /market/conversations/:id/messages     # streams response
DELETE /market/conversations/:id
POST   /market/conversations/:id/members      # invite friend (group chat)

POST   /market/agents/:id/voice-session       # returns LiveKit token

GET    /market/agents/:id/memory/me
DELETE /market/agents/:id/memory/me

GET    /market/usage/me
POST   /market/products/:id/reviews
GET    /market/products/:id/reviews
POST   /market/messages/:id/report
```

Message request:

```ts
interface AgentMessageRequest {
  content: string;           // max length enforced, e.g. 2000 chars
  clientMessageId: string;   // idempotency
}
```

Streamed response events:

```ts
type AgentStreamEvent =
  | { type: 'animation'; state: 'thinking' | 'talking' | 'idle' }
  | { type: 'delta'; text: string }
  | { type: 'done'; messageId: string; usage: { remaining: number } }
  | { type: 'error'; code: 'quota_exceeded' | 'blocked' | 'unavailable' };
```

---

# 13. AI Safety, Security, and Cost

## 13.1 Safety

- Moderate user input and agent output.
- Each agent has a safety profile restricting topics outside its specialty.
- Wellness and career agents include disclaimers; no medical, legal, or financial advice beyond general information.
- Detect and refuse prompt injection attempts ("ignore your instructions", "give it free").
- Age-appropriate behavior; restrict agents for minor accounts per platform policy.
- Users can report any agent message.

## 13.2 Security

- **Prices, purchases, quotas, and entitlements are decided by the server only.** Nothing an agent says can grant items, discounts, or credits.
- Agents have no tools that touch payments, other users' data, or external accounts in this phase.
- System prompts and model configs are server-only.
- All endpoints require auth, Zod validation, and rate limiting (SPEC §12).
- Provider API keys stored as environment secrets, never sent to clients.

## 13.3 Transparency & Privacy

- Every AI NPC is clearly labeled as AI.
- Memory is opt-in, viewable, and deletable.
- Conversation retention period documented and configurable.
- Shared posts include only content the user explicitly selects.

## 13.4 Cost Control

- Per-user daily request and token limits.
- Per-agent global budgets with alerts.
- Context window trimming and summarization.
- Smaller/cheaper models for greetings and simple replies; larger models only when needed.
- Cache static responses (greetings, product descriptions).
- Usage metrics exported to monitoring (SPEC §15).

## 13.5 New Environment Variables

```env
AI_SERVICE_PORT=3002
AI_PROVIDER=anthropic
AI_PROVIDER_API_KEY=
AI_DEFAULT_MODEL=
AI_USER_DAILY_REQUEST_LIMIT=50
AI_USER_DAILY_TOKEN_LIMIT=50000
AI_MODERATION_ENABLED=true
```

---

# 14. Updated Project Structure

```text
apps/
├── ai-agent-service/
│   ├── src/
│   │   ├── agents/
│   │   ├── conversations/
│   │   ├── providers/
│   │   ├── safety/
│   │   ├── usage/
│   │   ├── voice/
│   │   └── server.ts
│   └── package.json
│
├── api/src/modules/
│   ├── academy/
│   └── market/
│
└── web/src/features/
    ├── academy/
    └── market/

packages/
├── puzzle-engine/
├── robot-api/
└── agent-protocol/      # shared stream event + request types
```

---

# 15. Observability

Add metrics:

- Lesson attempts, success rate, and drop-off per lesson.
- Sandbox timeouts and violations.
- AI requests per agent, latency (time to first token), error rate.
- Token usage and cost per agent per day.
- Moderation flags per agent.
- Quota-exceeded events.

---

# 16. Milestones

These slot in after SPEC Milestone 03, before or alongside Milestone 04.

## Milestone A1 — Academy Prototype

Tasks:
- Create zone-academy scene with one puzzle room.
- Robot companion entity and animation.
- Blockly editor with sequence and loop blocks.
- Web Worker sandbox with time limit.
- `packages/puzzle-engine` deterministic simulation.
- Server-side action-log verification.
- 5 beginner puzzles.

Acceptance Criteria:
- User solves a puzzle with blocks and sees the robot move in 3D.
- Infinite loops are stopped without freezing the browser.
- A forged "success" request without a valid action log is rejected.
- Completion is saved and XP is awarded once.

## Milestone A2 — Academy Learning Loop

Tasks:
- Full 8-lesson beginner track.
- Split editor and Monaco editor.
- XP, levels, badges, streaks.
- Profile badges and shareable completion posts.
- AI tutor hints (requires Milestone B1).

## Milestone A3 — Social Learning

Tasks:
- Pair programming sessions.
- Coding battles.
- Live class screen in Event Center.
- Friends and weekly leaderboards.

## Milestone B1 — First AI Shop

Tasks:
- `ai-agent-service` with one provider adapter.
- Code Corner shop scene and shopkeeper NPC.
- Text conversation with streaming.
- NPC animation states synced via game server.
- Input/output moderation.
- Per-user daily limits.

Acceptance Criteria:
- User enters the shop, gets a greeting, and has a streamed text conversation.
- NPC animation changes while thinking and talking.
- Quota exceeded returns a friendly in-world message.
- Prompt injection asking for free items or the system prompt does not succeed.
- Game server tick duration is unaffected by AI latency.

## Milestone B2 — AI Agent Street

Tasks:
- 4–7 shops with distinct personas.
- Product displays, free trials, reviews.
- Opt-in memory with view/delete.
- Group conversations with friends.
- Share-to-feed.

## Milestone B3 — Voice Shopkeepers

Tasks:
- LiveKit agent worker (STT → LLM → TTS).
- Push-to-talk conversation.
- Mouth / lip-sync animation.
- Voice latency benchmarking.

## Milestone B4 — Partner Shops (Later)

Tasks:
- Partner onboarding and agent configuration UI.
- Review and approval workflow in Admin Dashboard (SPEC §16).
- Partner analytics.
- Paid plans via secure payment workflow.

---

# 17. Testing

## Unit
- Puzzle engine determinism (same actions → same result).
- Action-log validation and limits.
- Sandbox timeout and blocked globals.
- Prompt builder output.
- Quota calculations.

## Integration
- Lesson attempt → XP → badge transaction.
- Agent conversation create → message → stream → usage recorded.
- Memory delete removes data.

## Security
- Sandbox escape attempts (accessing `fetch`, `window`, prototype tricks).
- Forged attempt submissions.
- Prompt injection test suite per agent.
- Attempt to read `system_prompt` via API.

## Load
- Concurrent AI conversations vs. latency and cost.
- Academy zone with many simultaneous puzzle instances.

---

# 18. Open Questions

1. Which LLM provider(s) and models for launch, and what monthly AI budget?
2. Will users pay for AI products in the MVP, or free-with-limits only?
3. Minimum user age, and how agents behave for minors?
4. Should Academy content be available in Bangla as well as English from launch?
5. Who authors curriculum content: internal team or community?
6. Retention period for agent conversation history?

---

**Principle:** Learn by doing, talk to helpful agents, and let the world itself be the interface.

**End of Addendum**
