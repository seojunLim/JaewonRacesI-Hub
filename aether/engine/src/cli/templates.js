/**
 * Project templates for `sjl new`.
 *
 * Each template is a complete, playable game — not a stub. That is the point:
 * a new project should be something you can run and modify immediately, and it
 * should demonstrate the idioms (schema-declared behaviors, scene-authored
 * levels, seeded randomness) that the rest of the engine assumes.
 *
 * Templates are plain objects mapping relative path -> file contents, so a
 * template is data and adding one requires no new machinery.
 */

import { VERSION } from '../version.js';

const INDEX_HTML = (name) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
    <title>${name}</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      html, body { margin: 0; height: 100%; background: #0b0d12; overflow: hidden; }
      #game { position: fixed; inset: 0; }
      canvas { display: block; width: 100%; height: 100%; outline: none; }
      #hint {
        position: fixed; left: 12px; bottom: 12px; z-index: 10;
        font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
        color: #7a869a; pointer-events: none; user-select: none;
      }
    </style>
  </head>
  <body>
    <div id="game"></div>
    <div id="hint">arrows / WASD to move &middot; space to jump &middot; R to restart &middot; \` for debug draw</div>
    <script type="module">
      import { createGame } from './engine/src/runtime/browser.js';
      import './src/behaviors.js';

      const game = await createGame({ mount: '#game', scene: 'scenes/main.json' });

      // Handy while developing; harmless to leave in.
      window.game = game;
      addEventListener('keydown', (event) => {
        if (event.key === '\`') game.setDebugDraw(!game.scheduler.get('DebugDrawSystem').enabled);
        if (event.key === 'r' || event.key === 'R') game.reloadScene();
      });
    </script>
  </body>
</html>
`;

const CONFIG = (name, extra = {}) =>
  `${JSON.stringify(
    {
      name,
      version: '0.1.0',
      engine: VERSION,
      scenes: ['scenes/main.json'],
      scripts: ['src/behaviors.js'],
      window: { width: 960, height: 540, title: name },
      renderer: 'auto',
      ...extra,
    },
    null,
    2,
  )}\n`;

const GITIGNORE = `node_modules/
dist/
.DS_Store
`;

const AGENTS_MD = (name) => `# ${name}

An SJL Engine game. Read this before changing anything.

## Where things live

- \`scenes/*.json\` — levels. Entities, components, prefabs. **Most changes belong here.**
- \`src/behaviors.js\` — game logic, as \`defineBehavior\` declarations.
- \`sjl.config.json\` — project settings and the input action map.
- \`index.html\` — the browser entry point.

## The workflow that works

\`\`\`sh
sjl describe --compact     # every component and behavior, with field types
sjl validate               # check scenes before running; reports all problems at once
sjl run --frames 180 --ascii   # play headlessly and see the result
sjl doctor                 # catch "loads but does nothing" problems
sjl dev                    # browser, with live reload
\`\`\`

Run \`sjl validate\` after every scene edit. It catches misspelled components and
fields, dangling entity references and missing assets — the failures that
otherwise produce a game that runs and quietly behaves wrong.

## Conventions that will bite you if you guess

- Rotation is in **degrees**, everywhere.
- **+y is up.** A platform below the player has a smaller y.
- Positions are in **world units**, not pixels. The camera's \`size\` is a
  half-height: \`size: 6\` shows 12 units vertically.
- Gameplay goes in \`onFixedUpdate\` (constant dt), visuals in \`onUpdate\`.
- Every entity that a reference points at needs an \`"id"\`.

## Adding a behavior

\`\`\`js
defineBehavior({
  name: 'Chase',
  props: { speed: { type: 'number', default: 3, min: 0 } },
  onFixedUpdate({ entity, props, world, dt }) {
    const target = world.findFirstByTag('player');
    if (!target) return;
    // ...
  },
});
\`\`\`

Declared props are validated, appear in the inspector, and show up in
\`sjl describe\`. Reading an undeclared prop gets you \`undefined\`.
`;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function blank(name) {
  return {
    'sjl.config.json': CONFIG(name),
    '.gitignore': GITIGNORE,
    'index.html': INDEX_HTML(name),
    'AGENTS.md': AGENTS_MD(name),
    'src/behaviors.js': `/**
 * Game behaviors.
 *
 * Anything declared here can be attached from a scene file:
 *   "behaviors": [{ "type": "Hello", "message": "hi" }]
 */

import { defineBehavior } from '../engine/src/index.js';

defineBehavior({
  name: 'Hello',
  description: 'Logs a message once, to prove the wiring works.',
  props: {
    message: { type: 'string', default: 'Hello from SJL Engine' },
  },
  onStart({ props, entity }) {
    console.log(\`[\${entity.name}] \${props.message}\`);
  },
});
`,
    'scenes/main.json': `${JSON.stringify(
      {
        name: 'main',
        settings: { gravity: [0, -20] },
        entities: [
          {
            id: 'camera',
            name: 'Camera',
            components: { Transform: { position: [0, 0] }, Camera: { size: 6, background: '#0d1117' } },
          },
          {
            id: 'hello',
            name: 'Box',
            components: {
              Transform: { position: [0, 0] },
              ShapeRenderer: { shape: 'rectangle', size: [1, 1], color: '#4cc9f0' },
            },
            behaviors: [{ type: 'Spin', degreesPerSecond: 60 }, { type: 'Hello' }],
          },
        ],
      },
      null,
      2,
    )}\n`,
  };
}

function platformer(name) {
  return {
    'sjl.config.json': CONFIG(name),
    '.gitignore': GITIGNORE,
    'index.html': INDEX_HTML(name),
    'AGENTS.md': AGENTS_MD(name),
    'src/behaviors.js': `/**
 * Game behaviors for the platformer template.
 *
 * The movement itself comes from the engine's built-in PlatformerController;
 * what is here is the game-specific part — scoring and the goal.
 */

import { defineBehavior } from '../engine/src/index.js';

defineBehavior({
  name: 'ScoreKeeper',
  description: 'Tracks collected coins and writes the total into a Text component.',
  requires: ['Text'],
  props: {
    prefix: { type: 'string', default: 'Coins: ' },
    total: { type: 'int', default: 0, min: 0, description: 'How many coins the level contains' },
  },
  onStart({ entity, state, world, props }) {
    state.score = 0;
    // Count them at load time rather than trusting a hand-maintained number.
    const declared = world.findByTag('coin').length;
    state.total = props.total || declared;
    entity.require('Text').text = \`\${props.prefix}0 / \${state.total}\`;

    // Behaviors can subscribe to world events; the engine cleans up with the world.
    world.events.on('coin:collected', () => {
      state.score++;
      entity.require('Text').text = \`\${props.prefix}\${state.score} / \${state.total}\`;
      if (state.score >= state.total) world.events.queue('level:complete', {});
    });
  },
});

defineBehavior({
  name: 'Goal',
  description: 'Shows a banner when the player reaches it after collecting every coin.',
  props: {
    message: { type: 'string', default: 'You win!' },
  },
  onStart({ state, world }) {
    state.unlocked = false;
    world.events.on('level:complete', () => {
      state.unlocked = true;
    });
  },
  onTriggerEnter({ other, state, props, world }) {
    if (!other.hasTag('player')) return;
    const banner = world.findByName('Banner');
    if (!banner) return;
    banner.get('Text').text = state.unlocked ? props.message : 'Collect all the coins first';
  },
});

defineBehavior({
  name: 'Respawn',
  description: 'Returns the player to the start when it falls out of the level.',
  requires: ['Transform', 'Rigidbody'],
  props: {
    killY: { type: 'number', default: -8 },
  },
  onStart({ entity, state }) {
    const t = entity.require('Transform');
    state.startX = t.position.x;
    state.startY = t.position.y;
  },
  onFixedUpdate({ entity, props, state }) {
    const t = entity.require('Transform');
    if (t.position.y > props.killY) return;
    t.position.x = state.startX;
    t.position.y = state.startY;
    const body = entity.require('Rigidbody');
    body.velocity.x = 0;
    body.velocity.y = 0;
  },
});
`,
    'scenes/main.json': `${JSON.stringify(platformerScene(), null, 2)}\n`,
  };
}

function platformerScene() {
  const platform = (id, x, y, w) => ({
    id,
    name: 'Platform',
    tags: ['ground'],
    components: {
      Transform: { position: [x, y] },
      ShapeRenderer: { shape: 'rectangle', size: [w, 0.5], color: '#2d3748' },
      BoxCollider: { size: [w, 0.5], friction: 0.4 },
    },
  });

  const coin = (id, x, y) => ({ id, prefab: 'Coin', components: { Transform: { position: [x, y] } } });

  return {
    name: 'main',
    settings: { gravity: [0, -25], seed: 'platformer-1' },
    prefabs: {
      Coin: {
        name: 'Coin',
        tags: ['coin'],
        components: {
          Transform: { position: [0, 0] },
          ShapeRenderer: { shape: 'circle', size: [0.4, 0.4], color: '#ffd166' },
          CircleCollider: { radius: 0.25, isTrigger: true },
        },
        behaviors: [
          { type: 'Spin', degreesPerSecond: 120 },
          { type: 'Oscillate', axis: 'y', amplitude: 0.15, frequency: 1.2 },
          { type: 'DestroyOnTrigger', tag: 'player', destroy: 'self', event: 'coin:collected' },
        ],
      },
    },
    entities: [
      {
        id: 'camera',
        name: 'Camera',
        components: {
          Transform: { position: [0, 2] },
          Camera: { size: 6, background: '#0b0d12' },
          CameraFollow: { target: 'player', halfLife: 0.15, deadZone: [1.5, 1] },
        },
      },
      {
        id: 'player',
        name: 'Player',
        tags: ['player'],
        components: {
          Transform: { position: [-6, 1] },
          ShapeRenderer: { shape: 'rectangle', size: [0.7, 1], color: '#4cc9f0' },
          Rigidbody: { type: 'dynamic', freezeRotation: true, linearDamping: 0 },
          BoxCollider: { size: [0.7, 1], friction: 0.1 },
        },
        behaviors: [
          { type: 'PlatformerController', speed: 7, jumpHeight: 2.6, maxJumps: 2 },
          { type: 'Respawn', killY: -8 },
        ],
      },
      platform('ground', 0, -2, 14),
      platform('ledge-1', -3, 0.5, 3),
      platform('ledge-2', 2, 2, 3),
      platform('ledge-3', 6, 3.5, 3),
      {
        id: 'moving-platform',
        name: 'MovingPlatform',
        tags: ['ground'],
        components: {
          Transform: { position: [-1, 4.5] },
          ShapeRenderer: { shape: 'rectangle', size: [2, 0.4], color: '#7b61ff' },
          Rigidbody: { type: 'kinematic' },
          BoxCollider: { size: [2, 0.4], friction: 0.6 },
        },
        behaviors: [{ type: 'Patrol', axis: 'x', distance: 2.5, speed: 2 }],
      },
      coin('coin-1', -3, 1.4),
      coin('coin-2', 2, 2.9),
      coin('coin-3', 6, 4.4),
      coin('coin-4', -1, 5.5),
      {
        id: 'goal',
        name: 'Goal',
        components: {
          Transform: { position: [6, 4.6] },
          ShapeRenderer: { shape: 'rectangle', size: [0.6, 1.2], color: '#3ddc84' },
          BoxCollider: { size: [0.6, 1.2], isTrigger: true },
        },
        behaviors: [{ type: 'Goal', message: 'You win!' }],
      },
      {
        id: 'score',
        name: 'Score',
        components: {
          // `screenSpace` text is positioned in CSS pixels from the top-left,
          // so it stays put while the camera follows the player.
          Transform: { position: [16, 28] },
          Text: { text: 'Coins: 0', size: 24, screenSpace: true, align: 'left', color: '#e6edf3' },
        },
        behaviors: [{ type: 'ScoreKeeper' }],
      },
      {
        id: 'banner',
        name: 'Banner',
        components: {
          Transform: { position: [0, 6.5] },
          Text: { text: '', size: 0.8, color: '#3ddc84', align: 'center' },
        },
      },
    ],
  };
}

function topdown(name) {
  return {
    'sjl.config.json': CONFIG(name),
    '.gitignore': GITIGNORE,
    'index.html': INDEX_HTML(name),
    'AGENTS.md': AGENTS_MD(name),
    'src/behaviors.js': `import { defineBehavior, getPhysics } from '../engine/src/index.js';

defineBehavior({
  name: 'ChasePlayer',
  description: 'Moves toward the nearest entity tagged "player".',
  requires: ['Transform'],
  props: {
    speed: { type: 'number', default: 2, min: 0 },
    stopDistance: { type: 'number', default: 0.6, min: 0 },
  },
  onFixedUpdate({ entity, props, world, dt }) {
    const player = world.findFirstByTag('player');
    if (!player?.alive) return;

    const self = entity.require('Transform');
    const target = player.require('Transform');
    const dx = target.position.x - self.position.x;
    const dy = target.position.y - self.position.y;
    const distance = Math.hypot(dx, dy);
    if (distance < props.stopDistance || distance === 0) return;

    const body = entity.get('Rigidbody');
    const vx = (dx / distance) * props.speed;
    const vy = (dy / distance) * props.speed;
    if (body) {
      body.velocity.x = vx;
      body.velocity.y = vy;
      body.sleeping = false;
    } else {
      self.position.x += vx * dt;
      self.position.y += vy * dt;
    }
  },
});
`,
    'scenes/main.json': `${JSON.stringify(
      {
        name: 'main',
        settings: { gravity: [0, 0], seed: 'topdown-1' },
        prefabs: {
          Enemy: {
            name: 'Enemy',
            tags: ['enemy'],
            components: {
              Transform: { position: [0, 0] },
              ShapeRenderer: { shape: 'circle', size: [0.7, 0.7], color: '#ef476f' },
              Rigidbody: { type: 'dynamic', linearDamping: 6 },
              CircleCollider: { radius: 0.35 },
            },
            behaviors: [{ type: 'ChasePlayer', speed: 2.2 }],
          },
        },
        entities: [
          {
            id: 'camera',
            name: 'Camera',
            components: {
              Transform: { position: [0, 0] },
              Camera: { size: 7, background: '#0b0d12' },
              CameraFollow: { target: 'player', halfLife: 0.2 },
            },
          },
          {
            id: 'player',
            name: 'Player',
            tags: ['player'],
            components: {
              Transform: { position: [0, 0] },
              ShapeRenderer: { shape: 'circle', size: [0.8, 0.8], color: '#4cc9f0' },
              Rigidbody: { type: 'dynamic', linearDamping: 8, freezeRotation: true },
              CircleCollider: { radius: 0.4 },
            },
            behaviors: [{ type: 'TopDownController', speed: 5 }, { type: 'MouseAim' }],
          },
          {
            id: 'spawner',
            name: 'Spawner',
            components: { Transform: { position: [0, 6] } },
            behaviors: [
              { type: 'Spawner', prefab: 'Enemy', interval: 2, maxAlive: 8, spread: [7, 1] },
            ],
          },
          ...wallRing(),
        ],
      },
      null,
      2,
    )}\n`,
  };
}

/** Four static walls enclosing the top-down arena. */
function wallRing() {
  const wall = (id, x, y, w, h) => ({
    id,
    name: 'Wall',
    tags: ['wall'],
    components: {
      Transform: { position: [x, y] },
      ShapeRenderer: { shape: 'rectangle', size: [w, h], color: '#2d3748' },
      BoxCollider: { size: [w, h] },
    },
  });
  return [
    wall('wall-top', 0, 7.5, 20, 0.5),
    wall('wall-bottom', 0, -7.5, 20, 0.5),
    wall('wall-left', -10, 0, 0.5, 15),
    wall('wall-right', 10, 0, 0.5, 15),
  ];
}

function breakout(name) {
  const bricks = [];
  const colors = ['#ef476f', '#f78c6b', '#ffd166', '#06d6a0', '#4cc9f0'];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 9; col++) {
      bricks.push({
        id: `brick-${row}-${col}`,
        prefab: 'Brick',
        components: {
          Transform: { position: [-6.4 + col * 1.6, 3 + row * 0.6] },
          ShapeRenderer: { color: colors[row] },
        },
      });
    }
  }

  return {
    'sjl.config.json': CONFIG(name),
    '.gitignore': GITIGNORE,
    'index.html': INDEX_HTML(name),
    'AGENTS.md': AGENTS_MD(name),
    'src/behaviors.js': `import { defineBehavior } from '../engine/src/index.js';

defineBehavior({
  name: 'Paddle',
  description: 'Horizontal paddle driven by the moveX action, clamped to the play field.',
  requires: ['Transform'],
  props: {
    speed: { type: 'number', default: 12, min: 0 },
    limit: { type: 'number', default: 7, min: 0, description: 'Max distance from x=0' },
  },
  onFixedUpdate({ entity, props, world, dt }) {
    const input = world.getResource('input');
    const t = entity.require('Transform');
    t.position.x += input.axis('moveX') * props.speed * dt;
    t.position.x = Math.max(-props.limit, Math.min(props.limit, t.position.x));

    // The paddle is kinematic, so the solver needs its velocity to transfer
    // momentum into the ball on contact.
    const body = entity.get('Rigidbody');
    if (body) body.velocity.x = input.axis('moveX') * props.speed;
  },
});

defineBehavior({
  name: 'Ball',
  description: 'Keeps the ball at a constant speed and relaunches it when it is lost.',
  requires: ['Transform', 'Rigidbody'],
  props: {
    speed: { type: 'number', default: 9, min: 0.1 },
    loseY: { type: 'number', default: -6 },
  },
  onStart({ entity, props, world, state }) {
    state.lives = 3;
    launch(entity, props, world);
  },
  onFixedUpdate({ entity, props, world, state }) {
    const body = entity.require('Rigidbody');
    const t = entity.require('Transform');

    // Renormalize: repeated bounces drift the speed, and a ball that slowly
    // creeps toward horizontal never comes back down.
    const current = Math.hypot(body.velocity.x, body.velocity.y);
    if (current > 0.001) {
      body.velocity.x = (body.velocity.x / current) * props.speed;
      body.velocity.y = (body.velocity.y / current) * props.speed;
    }
    if (Math.abs(body.velocity.y) < props.speed * 0.25) {
      body.velocity.y = Math.sign(body.velocity.y || 1) * props.speed * 0.25;
    }

    if (t.position.y < props.loseY) {
      state.lives--;
      const banner = world.findByName('Banner');
      if (state.lives <= 0) {
        if (banner) banner.get('Text').text = 'Game over';
        world.destroy(entity.id);
        return;
      }
      if (banner) banner.get('Text').text = \`Lives: \${state.lives}\`;
      launch(entity, props, world);
    }
  },
});

function launch(entity, props, world) {
  const t = entity.require('Transform');
  const body = entity.require('Rigidbody');
  t.position.x = 0;
  t.position.y = -2;
  // world.random, not Math.random: the launch angle stays reproducible.
  const angle = world.random.range(-0.4, 0.4) + Math.PI / 2;
  body.velocity.x = Math.cos(angle) * props.speed;
  body.velocity.y = Math.sin(angle) * props.speed;
  body.sleeping = false;
}

defineBehavior({
  name: 'BrickHit',
  description: 'Destroys the brick when the ball hits it, and announces the win.',
  onCollisionEnter({ entity, other, world }) {
    if (!other.hasTag('ball')) return;
    world.destroy(entity.id);
    // The brick being destroyed is deferred, so count what will remain.
    const remaining = world.findByTag('brick').length - 1;
    if (remaining <= 0) {
      const banner = world.findByName('Banner');
      if (banner) banner.get('Text').text = 'You win!';
    }
  },
});
`,
    'scenes/main.json': `${JSON.stringify(
      {
        name: 'main',
        settings: { gravity: [0, 0], seed: 'breakout-1', physics: { iterations: 12 } },
        prefabs: {
          Brick: {
            name: 'Brick',
            tags: ['brick'],
            components: {
              Transform: { position: [0, 0] },
              ShapeRenderer: { shape: 'rectangle', size: [1.4, 0.45], color: '#ef476f' },
              BoxCollider: { size: [1.4, 0.45], restitution: 1, friction: 0 },
            },
            behaviors: [{ type: 'BrickHit' }],
          },
        },
        entities: [
          {
            id: 'camera',
            name: 'Camera',
            components: { Transform: { position: [0, 0] }, Camera: { size: 6, background: '#0b0d12' } },
          },
          {
            id: 'paddle',
            name: 'Paddle',
            tags: ['paddle'],
            components: {
              Transform: { position: [0, -4] },
              ShapeRenderer: { shape: 'rectangle', size: [2, 0.35], color: '#4cc9f0' },
              Rigidbody: { type: 'kinematic' },
              BoxCollider: { size: [2, 0.35], restitution: 1, friction: 0 },
            },
            behaviors: [{ type: 'Paddle', speed: 12, limit: 7 }],
          },
          {
            id: 'ball',
            name: 'Ball',
            tags: ['ball'],
            components: {
              Transform: { position: [0, -2] },
              ShapeRenderer: { shape: 'circle', size: [0.35, 0.35], color: '#ffffff' },
              Rigidbody: { type: 'dynamic', gravityScale: 0, linearDamping: 0, canSleep: false },
              CircleCollider: { radius: 0.175, restitution: 1, friction: 0 },
            },
            behaviors: [{ type: 'Ball', speed: 9 }],
          },
          {
            id: 'wall-left',
            name: 'WallLeft',
            components: {
              Transform: { position: [-8.5, 0] },
              ShapeRenderer: { shape: 'rectangle', size: [0.5, 13], color: '#2d3748' },
              BoxCollider: { size: [0.5, 13], restitution: 1, friction: 0 },
            },
          },
          {
            id: 'wall-right',
            name: 'WallRight',
            components: {
              Transform: { position: [8.5, 0] },
              ShapeRenderer: { shape: 'rectangle', size: [0.5, 13], color: '#2d3748' },
              BoxCollider: { size: [0.5, 13], restitution: 1, friction: 0 },
            },
          },
          {
            id: 'wall-top',
            name: 'WallTop',
            components: {
              Transform: { position: [0, 6] },
              ShapeRenderer: { shape: 'rectangle', size: [17.5, 0.5], color: '#2d3748' },
              BoxCollider: { size: [17.5, 0.5], restitution: 1, friction: 0 },
            },
          },
          ...bricks,
          {
            id: 'banner',
            name: 'Banner',
            components: {
              Transform: { position: [0, -5.2] },
              Text: { text: 'Lives: 3', size: 0.5, color: '#e6edf3', align: 'center' },
            },
          },
        ],
      },
      null,
      2,
    )}\n`,
  };
}


// ---------------------------------------------------------------------------
// 3D
// ---------------------------------------------------------------------------

const INDEX_HTML_3D = (name) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
    <title>${name}</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      html, body { margin: 0; height: 100%; background: #05070d; overflow: hidden; }
      #game { position: fixed; inset: 0; }
      canvas { display: block; width: 100%; height: 100%; outline: none; }
      #hint {
        position: fixed; left: 14px; bottom: 12px; z-index: 10;
        font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
        color: #5c6879; pointer-events: none; user-select: none;
      }
      #hint b { color: #8b97a8; font-weight: 600; }
    </style>
  </head>
  <body>
    <div id="game"></div>
    <div id="hint">
      <b>WASD</b> to move &middot; <b>space</b> to jump &middot;
      <b>drag</b> to orbit the camera &middot; <b>wheel</b> to zoom &middot; <b>R</b> to restart
    </div>
    <script type="module">
      import { createGame } from './engine/src/runtime/browser.js';
      import './src/behaviors.js';

      const game = await createGame({ mount: '#game', scene: 'scenes/main.json' });

      window.game = game;
      addEventListener('keydown', (event) => {
        if (event.key === 'r' || event.key === 'R') game.reloadScene();
      });
    </script>
  </body>
</html>
`;

const AGENTS_MD_3D = (name) => `# ${name}

An SJL Engine **3D** game. Read this before changing anything.

## Where things live

- \`scenes/*.json\` — levels. Entities, components, prefabs. **Most changes belong here.**
- \`src/behaviors.js\` — game logic, as \`defineBehavior\` declarations.
- \`sjl.config.json\` — project settings and the input action map.

## The workflow that works

\`\`\`sh
sjl describe --compact          # every component and behavior, with field types
sjl validate                    # check scenes; reports all problems at once
sjl run --frames 180 --ascii    # play headlessly, see the camera view as text
sjl run --frames 180 --topdown  # ...or as a top-down map of the level
sjl doctor                      # catch "loads but does nothing" problems
sjl dev                         # browser, with live reload
\`\`\`

## 3D conventions that will bite you if you guess

- **Right-handed, y-up.** +x right, +y up, +z **toward the viewer**. An
  unrotated camera looks down **-z**, so the level extends into negative z.
- Rotation is a **vec3 of Euler degrees**, applied **YXZ**: x is pitch, y is
  yaw, z is roll. \`[0, 90, 0]\` turns a quarter-circle to the left.
- Use the **3D component set** — \`Transform3D\`, \`MeshRenderer\`, \`Camera3D\`,
  \`Rigidbody3D\`, \`BoxCollider3D\`, \`SphereCollider\`. Never mix them with the 2D
  ones on the same entity; \`sjl validate\` treats that as an error.
- A 3D scene needs a **Light**, or everything renders black. One directional
  plus one ambient is the usual pair.
- Colliders are **axis-aligned boxes and spheres**. Entity rotation does not
  rotate a collider — build rotated shapes from several boxes.
- \`MeshRenderer.size\` is in world units and scales the unit primitive, so a
  \`size\` of \`[20, 1, 20]\` is a 20x1x20 floor.
- Gravity for 3D is \`settings.gravity3d\` (a vec3), not \`settings.gravity\`.

## Adding a behavior

\`\`\`js
defineBehavior({
  name: 'Chase3D',
  requires: ['Transform3D', 'Rigidbody3D'],
  props: { speed: { type: 'number', default: 3, min: 0 } },
  onFixedUpdate({ entity, props, world, dt }) {
    const target = world.findFirstByTag('player');
    if (!target) return;
    // ...
  },
});
\`\`\`
`;

function threeD(name) {
  return {
    'sjl.config.json': CONFIG(name, { window: { width: 960, height: 600, title: name } }),
    '.gitignore': GITIGNORE,
    'index.html': INDEX_HTML_3D(name),
    'AGENTS.md': AGENTS_MD_3D(name),
    'src/behaviors.js': `/**
 * Game behaviors for the 3D template.
 *
 * Movement and the camera come from the engine's built-in ThirdPersonController
 * and CameraOrbit; what is here is the game-specific part.
 */

import { defineBehavior } from '../engine/src/index.js';

defineBehavior({
  name: 'GemCounter',
  description: 'Counts collected gems and writes the total into a screen-space Text.',
  requires: ['Text'],
  props: {
    prefix: { type: 'string', default: 'Gems: ' },
  },
  onStart({ entity, state, world, props }) {
    state.collected = 0;
    state.total = world.findByTag('gem').length;
    entity.require('Text').text = \`\${props.prefix}0 / \${state.total}\`;

    world.events.on('gem:collected', () => {
      state.collected++;
      entity.require('Text').text = \`\${props.prefix}\${state.collected} / \${state.total}\`;
      if (state.collected >= state.total) {
        const banner = world.findByName('Banner');
        if (banner) banner.get('Text').text = 'All gems collected!';
      }
    });
  },
});

defineBehavior({
  name: 'FallReset',
  description: 'Returns the player to the start after falling off the level.',
  requires: ['Transform3D', 'Rigidbody3D'],
  props: {
    killY: { type: 'number', default: -12 },
  },
  onStart({ entity, state }) {
    const t = entity.require('Transform3D');
    state.start = { x: t.position.x, y: t.position.y, z: t.position.z };
  },
  onFixedUpdate({ entity, props, state }) {
    const t = entity.require('Transform3D');
    if (t.position.y > props.killY) return;

    t.position.x = state.start.x;
    t.position.y = state.start.y;
    t.position.z = state.start.z;

    const body = entity.require('Rigidbody3D');
    body.velocity.x = 0;
    body.velocity.y = 0;
    body.velocity.z = 0;
  },
});
`,
    'scenes/main.json': `${JSON.stringify(threeDScene(), null, 2)}\n`,
  };
}

function threeDScene() {
  const platform = (id, x, y, z, w, h, d, color) => ({
    id,
    name: 'Platform',
    tags: ['ground'],
    components: {
      Transform3D: { position: [x, y, z] },
      MeshRenderer: { mesh: 'box', size: [w, h, d], color },
      BoxCollider3D: { size: [w, h, d], friction: 0.6 },
    },
  });

  const gem = (id, x, y, z) => ({
    id,
    prefab: 'Gem',
    components: { Transform3D: { position: [x, y, z] } },
  });

  return {
    name: 'main',
    settings: {
      gravity3d: [0, -22, 0],
      seed: 'level-1',
      skybox: { top: '#25406b', bottom: '#080b12', horizon: 0.45 },
    },
    prefabs: {
      Gem: {
        name: 'Gem',
        tags: ['gem'],
        components: {
          Transform3D: { position: [0, 0, 0], scale: [1, 1, 1] },
          MeshRenderer: { mesh: 'sphere', size: [0.5, 0.5, 0.5], color: '#ffd166', emissive: 0.4, shininess: 0.8 },
          SphereCollider: { radius: 0.5, isTrigger: true },
        },
        behaviors: [
          { type: 'Spin3D', degreesPerSecond: [0, 140, 0] },
          { type: 'Hover3D', amplitude: 0.2, frequency: 0.8 },
          { type: 'Collect3D', tag: 'player', event: 'gem:collected' },
        ],
      },
    },
    entities: [
      {
        id: 'camera',
        name: 'Camera',
        components: {
          Transform3D: { position: [0, 6, 12] },
          Camera3D: { fov: 60, near: 0.1, far: 200, background: '#080b12', fogDensity: 0.012, fogColor: '#101828' },
          CameraOrbit: {
            target: 'player',
            targetOffset: [0, 1.2, 0],
            distance: 9,
            pitch: 22,
            halfLife: 0.1,
            mouseControl: true,
            minDistance: 4,
            maxDistance: 20,
          },
        },
      },
      {
        id: 'sun',
        name: 'Sun',
        components: {
          Transform3D: { rotation: [-45, 35, 0] },
          Light: { type: 'directional', color: '#fff6e0', intensity: 0.95 },
        },
      },
      {
        id: 'fill',
        name: 'AmbientLight',
        components: {
          Transform3D: {},
          Light: { type: 'ambient', color: '#5878a8', intensity: 0.35 },
        },
      },
      {
        id: 'player',
        name: 'Player',
        tags: ['player'],
        components: {
          Transform3D: { position: [0, 2, 6] },
          MeshRenderer: { mesh: 'box', size: [0.8, 1.6, 0.8], color: '#4cc9f0', shininess: 0.35 },
          Rigidbody3D: { type: 'dynamic', linearDamping: 0.1 },
          BoxCollider3D: { size: [0.8, 1.6, 0.8], friction: 0.2 },
        },
        behaviors: [
          { type: 'ThirdPersonController', speed: 6.5, jumpHeight: 1.8 },
          { type: 'FallReset', killY: -12 },
        ],
        children: [
          {
            id: 'nose',
            name: 'Nose',
            components: {
              Transform3D: { position: [0, 0.35, -0.5], rotation: [90, 0, 0] },
              MeshRenderer: { mesh: 'cone', size: [0.35, 0.4, 0.35], color: '#e6edf3' },
            },
          },
        ],
      },

      platform('ground', 0, 0, 4, 16, 1, 16, '#3a4a63'),
      platform('step-1', -6, 1.6, -6, 5, 1, 5, '#44557a'),
      platform('step-2', 2, 3.2, -10, 5, 1, 5, '#4c5f88'),
      platform('step-3', 8, 5, -4, 4, 1, 4, '#556a96'),

      {
        id: 'lift',
        name: 'MovingPlatform',
        tags: ['ground'],
        components: {
          Transform3D: { position: [-2, 2.4, -2] },
          MeshRenderer: { mesh: 'box', size: [3, 0.5, 3], color: '#7b61ff', shininess: 0.5 },
          Rigidbody3D: { type: 'kinematic' },
          BoxCollider3D: { size: [3, 0.5, 3], friction: 0.9 },
        },
        behaviors: [{ type: 'Patrol3D', axis: 'x', distance: 3.5, speed: 2 }],
      },

      {
        id: 'beacon',
        name: 'Beacon',
        components: {
          Transform3D: { position: [8, 6.5, -4] },
          MeshRenderer: { mesh: 'cylinder', size: [0.4, 1.6, 0.4], color: '#3ddc84', emissive: 0.5 },
        },
        children: [
          {
            id: 'beacon-light',
            name: 'BeaconLight',
            components: {
              Transform3D: { position: [0, 1, 0] },
              Light: { type: 'point', color: '#3ddc84', intensity: 1.4, range: 12 },
            },
          },
        ],
      },

      gem('gem-1', -6, 3, -6),
      gem('gem-2', 2, 4.6, -10),
      gem('gem-3', 8, 6.4, -4),
      gem('gem-4', 0, 1.6, 4),
      gem('gem-5', -2, 4, -2),

      {
        // The HUD is 2D. Screen-space Text uses the 2D component set, so these
        // entities carry Transform (not Transform3D) and the scene needs a 2D
        // Camera for the overlay pass to run at all. The 2D pass draws after
        // the 3D one, so the HUD lands on top of the world.
        id: 'hud-camera',
        name: 'HudCamera',
        components: {
          Transform: { position: [0, 0] },
          Camera: { size: 5, background: '#00000000' },
        },
      },
      {
        id: 'hud',
        name: 'Hud',
        components: {
          // Screen-space text is positioned in CSS pixels from the top-left.
          Transform: { position: [16, 30] },
          Text: { text: '', size: 20, color: '#e6edf3', align: 'left', screenSpace: true, layer: 100 },
        },
        behaviors: [{ type: 'GemCounter' }],
      },
      {
        id: 'banner',
        name: 'Banner',
        components: {
          Transform: { position: [16, 60] },
          Text: { text: '', size: 22, color: '#3ddc84', align: 'left', screenSpace: true, layer: 100 },
        },
      },
    ],
  };
}

export const TEMPLATES = { blank, platformer, topdown, breakout, '3d': threeD };
export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

/**
 * Render a template to a `{ path: contents }` map.
 * @param {string} template
 * @param {string} name project name
 */
export function renderTemplate(template, name) {
  const builder = TEMPLATES[template];
  if (!builder) {
    throw new Error(`Unknown template "${template}". Available: ${TEMPLATE_NAMES.join(', ')}`);
  }
  return builder(name);
}
