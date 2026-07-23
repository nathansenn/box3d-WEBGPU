import { LcgRng, clamp, saturate, vec3Length, vec3Normalize, writeModelMatrixFromEuler, type Vec3 } from './math';
import type { AAAStagePrimitive } from './aaa-improvements';
import type { DebugLine, EffectFrame } from './types';

type Particle = {
  pos: Vec3;
  vel: Vec3;
  rot: Vec3;
  angularVelocity: Vec3;
  half: Vec3;
  color: [number, number, number, number];
  life: number;
  maxLife: number;
  gravity: number;
  drag: number;
  growth: number;
};

type Shockwave = {
  center: Vec3;
  radius: number;
  speed: number;
  life: number;
  maxLife: number;
  color: [number, number, number, number];
  plane?: 'horizontal' | 'vertical';
};

export type CameraShakeSample = {
  yaw: number;
  pitch: number;
  targetOffset: Vec3;
};

const EMPTY_SHAKE: CameraShakeSample = { yaw: 0, pitch: 0, targetOffset: [0, 0, 0] };
const ABSOLUTE_TRANSIENT_PARTICLE_LIMIT = 3072;
const ABSOLUTE_SHOCKWAVE_LIMIT = 32;

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function hexColor(hex: number, emissive = 1): [number, number, number, number] {
  return [
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
    emissive,
  ];
}

export class CinematicEffects {
  private particles: Particle[] = [];
  private shockwaves: Shockwave[] = [];
  private stageProps: readonly AAAStagePrimitive[] = [];
  private rng = new LcgRng(0xa11ce);
  private effectMatrices = new Float32Array(256);
  private effectColors = new Float32Array(64);
  private readonly shockwaveLines: DebugLine[] = [];
  private frameVersionValue = 0;
  private builtFrameVersion = -1;
  private readonly cachedFrame: EffectFrame = {
    matrices: this.effectMatrices,
    colors: this.effectColors,
    count: 0,
    frameVersion: -1,
    debugLines: this.shockwaveLines,
  };
  private shakeEnergy = 0;
  private elapsed = 0;

  clear(seed = 0xa11ce): void {
    this.particles.length = 0;
    this.shockwaves.length = 0;
    this.stageProps = [];
    this.rng = new LcgRng(seed >>> 0);
    this.shakeEnergy = 0;
    this.elapsed = 0;
    this.markFrameChanged();
  }

  particleCount(): number {
    return this.particles.length;
  }

  stagePropCount(): number {
    return this.stageProps.length;
  }

  setStageProps(props: readonly AAAStagePrimitive[]): void {
    if (this.stageProps === props) return;
    this.stageProps = props;
    this.markFrameChanged();
  }

  spawnExplosion(center: Vec3, intensity: number, budget: number): void {
    const count = Math.min(Math.max(24, Math.round(intensity * 4.5)), Math.max(24, budget));
    const hotCount = Math.round(count * 0.62);
    for (let i = 0; i < count; i++) {
      const dir = this.randomDirection(i < hotCount ? 0.32 : 0.72);
      const speed = i < hotCount ? this.rng.range(intensity * 0.45, intensity * 1.15) : this.rng.range(intensity * 0.08, intensity * 0.34);
      const size = i < hotCount ? this.rng.range(0.035, 0.13) : this.rng.range(0.16, 0.46);
      const life = i < hotCount ? this.rng.range(0.55, 1.35) : this.rng.range(1.2, 2.8);
      this.particles.push({
        pos: add(center, scale(dir, this.rng.range(0.05, 0.7))),
        vel: add(scale(dir, speed), [this.rng.signed(1.5), this.rng.range(1.5, 5.5), this.rng.signed(1.5)]),
        rot: [this.rng.signed(Math.PI), this.rng.signed(Math.PI), this.rng.signed(Math.PI)],
        angularVelocity: [this.rng.signed(9), this.rng.signed(9), this.rng.signed(9)],
        half: [size, size * this.rng.range(0.5, 2.4), size],
        color: i < hotCount
          ? hexColor(i % 3 === 0 ? 0xfff1a8 : i % 3 === 1 ? 0xff8a2a : 0xff3b1f, this.rng.range(4, 9))
          : hexColor(i % 2 ? 0x536174 : 0x2c3442, this.rng.range(1.05, 1.35)),
        life,
        maxLife: life,
        gravity: i < hotCount ? 10.5 : 1.6,
        drag: i < hotCount ? 0.94 : 0.975,
        growth: i < hotCount ? -0.18 : this.rng.range(0.05, 0.22),
      });
    }

    this.shockwaves.push({
      center: [...center] as Vec3,
      radius: 0.4,
      speed: Math.max(8, intensity * 1.45),
      life: 0.95,
      maxLife: 0.95,
      color: [1, 0.72, 0.26, 0.86],
    });
    this.addCameraShake(clamp(intensity * 0.055, 0.2, 1.4));
    this.finalizeSpawn(budget);
  }

  spawnProjectileMuzzle(position: Vec3, velocity: Vec3, budget: number): void {
    const direction = vec3Normalize(velocity);
    const count = Math.min(72, Math.max(18, Math.round(budget * 0.18)));
    for (let i = 0; i < count; i++) {
      const scatter = this.randomDirection(0.82);
      const back = add(scale(direction, -this.rng.range(2.5, 8.5)), scale(scatter, this.rng.range(0.3, 2.6)));
      const size = this.rng.range(0.025, 0.08);
      const life = this.rng.range(0.18, 0.72);
      this.particles.push({
        pos: add(position, scale(scatter, this.rng.range(0, 0.4))),
        vel: back,
        rot: [0, 0, 0],
        angularVelocity: [this.rng.signed(7), this.rng.signed(7), this.rng.signed(7)],
        half: [size, size * this.rng.range(1.5, 4.5), size],
        color: hexColor(i % 2 ? 0x65e8ff : 0xffdf7a, this.rng.range(3, 7)),
        life,
        maxLife: life,
        gravity: 2.2,
        drag: 0.92,
        growth: -0.08,
      });
    }
    this.addCameraShake(0.16);
    this.finalizeSpawn(budget);
  }

  spawnMetalStrike(center: Vec3, direction: Vec3, intensity: number, budget: number): void {
    const normal = vec3Normalize(direction);
    const safeIntensity = clamp(intensity, 0.25, 2);
    // Cold-forming produces mostly tiny coating/oxide flakes and only a brief
    // contact flash. A welding-scale spark shower made the press read as an
    // arcade effect rather than a mechanical test.
    const count = Math.min(52, Math.max(18, Math.round(budget * 0.09)));
    const flashCount = Math.max(3, Math.round(count * 0.18));
    for (let i = 0; i < count; i++) {
      const flash = i < flashCount;
      const scatter = this.randomDirection(0.18);
      const speed = this.rng.range(flash ? 4 : 1.2, flash ? 10 : 4.5) * (0.72 + safeIntensity * 0.34);
      const size = this.rng.range(flash ? 0.010 : 0.018, flash ? 0.028 : 0.052);
      const life = this.rng.range(flash ? 0.12 : 0.32, flash ? 0.42 : 1.05);
      this.particles.push({
        pos: add(center, scale(scatter, this.rng.range(0.02, 0.28))),
        vel: add(scale(scatter, speed), scale(normal, this.rng.range(-2.5, 1.2))),
        rot: [this.rng.signed(Math.PI), this.rng.signed(Math.PI), this.rng.signed(Math.PI)],
        angularVelocity: [this.rng.signed(12), this.rng.signed(12), this.rng.signed(12)],
        half: [size, size * this.rng.range(flash ? 2.5 : 0.6, flash ? 6 : 2.2), size],
        color: flash
          ? hexColor(i % 2 ? 0xffd27a : 0xff8b35, this.rng.range(2.4, 4.8))
          : [0.40, 0.44, 0.48, -2],
        life,
        maxLife: life,
        gravity: 12,
        drag: 0.94,
        growth: flash ? -0.18 : -0.04,
      });
    }
    this.shockwaves.push({
      center: [...center] as Vec3,
      radius: 0.18,
      speed: 7 + safeIntensity * 4,
      life: 0.42,
      maxLife: 0.42,
      color: [1, 0.62, 0.18, 0.92],
    });
    this.addCameraShake(0.18 + safeIntensity * 0.14);
    this.finalizeSpawn(budget);
  }

  spawnConcreteSpall(center: Vec3, intensity: number, budget: number): void {
    const safeIntensity = clamp(intensity, 0.25, 2);
    const count = Math.min(144, Math.max(36, Math.round(budget * 0.26)));
    const sparkCount = Math.max(4, Math.round(count * 0.07));
    const dustCount = Math.round(count * 0.58);
    for (let i = 0; i < count; i++) {
      const spark = i < sparkCount;
      const dust = !spark && i < sparkCount + dustCount;
      const direction = this.randomDirection(spark ? 0.1 : dust ? 0.62 : 0.35);
      const size = spark ? this.rng.range(0.012, 0.032) : dust ? this.rng.range(0.10, 0.30) : this.rng.range(0.06, 0.19);
      const life = spark ? this.rng.range(0.18, 0.54) : dust ? this.rng.range(1.4, 3.8) : this.rng.range(1.0, 2.8);
      this.particles.push({
        pos: add(center, [this.rng.signed(0.55), this.rng.signed(0.16), this.rng.signed(0.48)]),
        vel: scale(direction, spark
          ? this.rng.range(5, 11) * safeIntensity
          : this.rng.range(1.2, 5.4) * (0.75 + safeIntensity * 0.28)),
        rot: [this.rng.signed(Math.PI), this.rng.signed(Math.PI), this.rng.signed(Math.PI)],
        angularVelocity: [this.rng.signed(5), this.rng.signed(5), this.rng.signed(5)],
        half: spark
          ? [size, size * this.rng.range(3, 6), size]
          : dust
            ? [size * this.rng.range(0.8, 1.5), size * this.rng.range(0.45, 1.0), size * this.rng.range(0.8, 1.5)]
            : [size, size * this.rng.range(0.45, 1.1), size],
        color: spark
          ? hexColor(i % 2 ? 0xffc35a : 0xff6b24, this.rng.range(3.5, 7))
          : dust
            ? [0.53, 0.49, 0.42, -6]
            : i % 3 === 0
              ? [0.45, 0.43, 0.39, -1]
              : [0.22, 0.20, 0.17, -5],
        life,
        maxLife: life,
        gravity: spark ? 11 : dust ? 1.2 : 7.8,
        drag: spark ? 0.94 : dust ? 0.975 : 0.965,
        growth: spark ? -0.16 : dust ? this.rng.range(0.08, 0.20) : -0.03,
      });
    }
    this.shockwaves.push({
      center: [...center] as Vec3,
      radius: 0.35,
      speed: 5.5 + safeIntensity * 3,
      life: 0.72,
      maxLife: 0.72,
      color: [0.78, 0.70, 0.58, 0.58],
    });
    this.addCameraShake(0.22 + safeIntensity * 0.18);
    this.finalizeSpawn(budget);
  }

  spawnGlassFracture(center: Vec3, intensity: number, budget: number): void {
    const safeIntensity = clamp(intensity, 0.25, 2);
    const count = Math.min(160, Math.max(42, Math.round(budget * 0.28)));
    for (let i = 0; i < count; i++) {
      const glint = i % 6 === 0;
      const direction = this.randomDirection(-0.05);
      const size = this.rng.range(0.018, 0.065);
      const life = this.rng.range(0.45, 1.8);
      this.particles.push({
        pos: add(center, [this.rng.signed(0.46), this.rng.signed(0.46), this.rng.signed(0.10)]),
        vel: add(scale(direction, this.rng.range(3.5, 10.5) * (0.76 + safeIntensity * 0.24)), [0, this.rng.range(-0.8, 2.8), 0]),
        rot: [this.rng.signed(Math.PI), this.rng.signed(Math.PI), this.rng.signed(Math.PI)],
        angularVelocity: [this.rng.signed(11), this.rng.signed(11), this.rng.signed(11)],
        half: [size * this.rng.range(2.2, 5.4), size * this.rng.range(0.12, 0.38), size * 0.16],
        color: glint
          ? hexColor(i % 2 ? 0xffffff : 0xb9f3ff, this.rng.range(1.8, 3.6))
          : [0.40, 0.80, 0.92, -4],
        life,
        maxLife: life,
        gravity: 8.5,
        drag: 0.975,
        growth: -0.08,
      });
    }
    this.shockwaves.push({
      center: [...center] as Vec3,
      radius: 0.22,
      speed: 9 + safeIntensity * 4,
      life: 0.54,
      maxLife: 0.54,
      color: [0.52, 0.90, 1, 0.9],
      plane: 'vertical',
    });
    this.addCameraShake(0.16 + safeIntensity * 0.12);
    this.finalizeSpawn(budget);
  }

  spawnImpulseDust(center: Vec3, strength: number, budget: number): void {
    const count = Math.min(Math.max(16, Math.round(strength * 3)), Math.max(16, Math.round(budget * 0.35)));
    for (let i = 0; i < count; i++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const dir: Vec3 = [Math.cos(angle), this.rng.range(0.08, 0.42), Math.sin(angle)];
      const speed = this.rng.range(strength * 0.18, strength * 0.62);
      const size = this.rng.range(0.08, 0.32);
      const life = this.rng.range(0.8, 2.1);
      this.particles.push({
        pos: add(center, [this.rng.signed(0.8), this.rng.range(0, 0.45), this.rng.signed(0.8)]),
        vel: scale(dir, speed),
        rot: [this.rng.signed(Math.PI), this.rng.signed(Math.PI), this.rng.signed(Math.PI)],
        angularVelocity: [this.rng.signed(2), this.rng.signed(2), this.rng.signed(2)],
        half: [size, size * this.rng.range(0.5, 1.3), size],
        color: hexColor(i % 3 === 0 ? 0xcbbfa6 : 0x667085, 1.08),
        life,
        maxLife: life,
        gravity: 2.8,
        drag: 0.965,
        growth: 0.06,
      });
    }
    this.addCameraShake(clamp(strength * 0.025, 0.08, 0.6));
    this.finalizeSpawn(budget);
  }

  spawnRainFlash(center: Vec3, budget: number): void {
    const count = Math.min(96, Math.max(20, Math.round(budget * 0.2)));
    for (let i = 0; i < count; i++) {
      const life = this.rng.range(0.45, 1.15);
      const size = this.rng.range(0.025, 0.07);
      this.particles.push({
        pos: [center[0] + this.rng.signed(12), center[1] + this.rng.range(0, 12), center[2] + this.rng.signed(12)],
        vel: [this.rng.signed(0.7), this.rng.range(-11, -5), this.rng.signed(0.7)],
        rot: [0, 0, 0],
        angularVelocity: [0, 0, 0],
        half: [size, this.rng.range(0.25, 0.85), size],
        color: hexColor(i % 2 ? 0x6ee7ff : 0xa7f3ff, this.rng.range(2.2, 4.8)),
        life,
        maxLife: life,
        gravity: 4,
        drag: 0.998,
        growth: -0.02,
      });
    }
    this.finalizeSpawn(budget);
  }

  addCameraShake(amount: number): void {
    this.shakeEnergy = clamp(this.shakeEnergy + amount, 0, 2.2);
  }

  update(dt: number): void {
    const step = clamp(dt, 0, 0.05);
    this.elapsed += step;
    const dragScale = step * 60;
    // Every built-in effect uses one of these five drag coefficients. Compute
    // their identical exponential factors once per update instead of once per
    // particle; retain the legacy calculation for any future custom value.
    const hasParticles = this.particles.length > 0;
    const explosionHotDrag = hasParticles ? Math.pow(0.94, dragScale) : 1;
    const explosionSmokeDrag = hasParticles ? Math.pow(0.975, dragScale) : 1;
    const projectileDrag = hasParticles ? Math.pow(0.92, dragScale) : 1;
    const impulseDustDrag = hasParticles ? Math.pow(0.965, dragScale) : 1;
    const rainDrag = hasParticles ? Math.pow(0.998, dragScale) : 1;

    const hadRenderableEffects = this.particles.length > 0 || this.shockwaves.length > 0;
    let particleWrite = 0;
    for (let read = 0; read < this.particles.length; read++) {
      const particle = this.particles[read];
      particle.life -= step;
      particle.vel[1] -= particle.gravity * step;
      const drag = particle.drag === 0.94 ? explosionHotDrag
        : particle.drag === 0.975 ? explosionSmokeDrag
        : particle.drag === 0.92 ? projectileDrag
        : particle.drag === 0.965 ? impulseDustDrag
        : particle.drag === 0.998 ? rainDrag
        : Math.pow(particle.drag, dragScale);
      particle.vel[0] *= drag;
      particle.vel[1] *= drag;
      particle.vel[2] *= drag;
      particle.pos[0] += particle.vel[0] * step;
      particle.pos[1] += particle.vel[1] * step;
      particle.pos[2] += particle.vel[2] * step;
      particle.rot[0] += particle.angularVelocity[0] * step;
      particle.rot[1] += particle.angularVelocity[1] * step;
      particle.rot[2] += particle.angularVelocity[2] * step;
      const growth = 1 + particle.growth * step;
      particle.half[0] = Math.max(0.006, particle.half[0] * growth);
      particle.half[1] = Math.max(0.006, particle.half[1] * growth);
      particle.half[2] = Math.max(0.006, particle.half[2] * growth);
      if (particle.life > 0 && particle.pos[1] > -4) this.particles[particleWrite++] = particle;
    }
    this.particles.length = particleWrite;

    let waveWrite = 0;
    for (let read = 0; read < this.shockwaves.length; read++) {
      const wave = this.shockwaves[read];
      wave.life -= step;
      wave.radius += wave.speed * step;
      if (wave.life > 0) this.shockwaves[waveWrite++] = wave;
    }
    this.shockwaves.length = waveWrite;
    this.shakeEnergy *= Math.pow(0.88, dragScale);
    if (this.shakeEnergy < 0.002) this.shakeEnergy = 0;
    if (hadRenderableEffects) this.markFrameChanged();
  }

  cameraShake(): CameraShakeSample {
    if (this.shakeEnergy <= 0) return EMPTY_SHAKE;
    const e = this.shakeEnergy;
    return {
      yaw: (Math.sin(this.elapsed * 47.1) + Math.sin(this.elapsed * 91.7) * 0.45) * 0.006 * e,
      pitch: (Math.cos(this.elapsed * 53.3) + Math.sin(this.elapsed * 72.9) * 0.35) * 0.005 * e,
      targetOffset: [
        Math.sin(this.elapsed * 39.2) * 0.05 * e,
        Math.cos(this.elapsed * 43.7) * 0.035 * e,
        Math.sin(this.elapsed * 57.5) * 0.05 * e,
      ],
    };
  }

  buildFrame(maxInstances: number): EffectFrame {
    const stageCount = Math.min(maxInstances, this.stageProps.length);
    const particleCount = Math.min(Math.max(0, maxInstances - stageCount), this.particles.length);
    const count = stageCount + particleCount;
    if (this.builtFrameVersion === this.frameVersionValue && this.cachedFrame.count === count) {
      return this.cachedFrame;
    }
    this.ensureFrameCapacity(count);
    const matrices = this.effectMatrices;
    const colors = this.effectColors;

    for (let i = 0; i < stageCount; i++) {
      const prop = this.stageProps[i];
      writeModelMatrixFromEuler(matrices, i * 16, prop.pos, prop.rot, prop.half);
      colors.set(prop.color, i * 4);
    }

    for (let particleIndex = 0; particleIndex < particleCount; particleIndex++) {
      const i = stageCount + particleIndex;
      const particle = this.particles[particleIndex];
      const lifeRatio = saturate(particle.life / Math.max(0.001, particle.maxLife));
      writeModelMatrixFromEuler(matrices, i * 16, particle.pos, particle.rot, particle.half);
      const colorScale = 0.72 + lifeRatio * 0.28;
      const colorOffset = i * 4;
      colors[colorOffset] = particle.color[0] * colorScale;
      colors[colorOffset + 1] = particle.color[1] * colorScale;
      colors[colorOffset + 2] = particle.color[2] * colorScale;
      // Negative alpha values are renderer material IDs. Preserve transparent
      // glass, concrete dust, stone, and metal tags through the life fade;
      // only positive-alpha particles use the emissive decay convention.
      colors[colorOffset + 3] = particle.color[3] < 0
        ? particle.color[3]
        : 1 + Math.max(0, particle.color[3] - 1) * lifeRatio;
    }

    this.cachedFrame.matrices = matrices;
    this.cachedFrame.colors = colors;
    this.cachedFrame.count = count;
    this.cachedFrame.frameVersion = this.frameVersionValue;
    this.cachedFrame.debugLines = this.buildShockwaveLines();
    this.builtFrameVersion = this.frameVersionValue;
    return this.cachedFrame;
  }

  private markFrameChanged(): void {
    this.frameVersionValue = (this.frameVersionValue + 1) >>> 0;
    this.builtFrameVersion = -1;
  }

  private finalizeSpawn(budget: number): void {
    // Rendering already applies a per-frame instance budget, but the backing
    // simulation lists must be bounded too. Otherwise repeated actions while
    // paused can accumulate invisible particles that every future update still
    // integrates. Keep the newest deterministic effects and discard oldest
    // transients once twice the active render budget is resident.
    const particleLimit = Math.max(64, Math.min(
      ABSOLUTE_TRANSIENT_PARTICLE_LIMIT,
      Math.floor(Math.max(1, budget) * 2),
    ));
    if (this.particles.length > particleLimit) {
      const sourceStart = this.particles.length - particleLimit;
      for (let i = 0; i < particleLimit; i++) this.particles[i] = this.particles[sourceStart + i];
      this.particles.length = particleLimit;
    }

    const shockwaveLimit = Math.max(4, Math.min(
      ABSOLUTE_SHOCKWAVE_LIMIT,
      Math.ceil(Math.max(1, budget) / 48),
    ));
    if (this.shockwaves.length > shockwaveLimit) {
      const sourceStart = this.shockwaves.length - shockwaveLimit;
      for (let i = 0; i < shockwaveLimit; i++) this.shockwaves[i] = this.shockwaves[sourceStart + i];
      this.shockwaves.length = shockwaveLimit;
    }
    this.markFrameChanged();
  }

  private ensureFrameCapacity(count: number): void {
    const matrixFloats = count * 16;
    if (this.effectMatrices.length < matrixFloats) {
      let capacity = Math.max(256, this.effectMatrices.length);
      while (capacity < matrixFloats) capacity *= 2;
      this.effectMatrices = new Float32Array(capacity);
    }
    const colorFloats = count * 4;
    if (this.effectColors.length < colorFloats) {
      let capacity = Math.max(64, this.effectColors.length);
      while (capacity < colorFloats) capacity *= 2;
      this.effectColors = new Float32Array(capacity);
    }
  }

  private randomDirection(verticalBias: number): Vec3 {
    const v: Vec3 = [this.rng.signed(1), this.rng.signed(1) + verticalBias, this.rng.signed(1)];
    const length = vec3Length(v);
    return length > 0.0001 ? [v[0] / length, v[1] / length, v[2] / length] : [0, 1, 0];
  }

  private buildShockwaveLines(): DebugLine[] {
    const lines = this.shockwaveLines;
    let lineIndex = 0;
    const segments = 72;
    const angleStep = Math.PI * 2 / segments;
    const rotationCosine = Math.cos(angleStep);
    const rotationSine = Math.sin(angleStep);
    for (const wave of this.shockwaves) {
      const alpha = saturate(wave.life / wave.maxLife) * wave.color[3];
      let x = wave.radius;
      let z = 0;
      for (let i = 0; i < segments; i++) {
        const nextX = x * rotationCosine - z * rotationSine;
        const nextZ = x * rotationSine + z * rotationCosine;
        let line = lines[lineIndex];
        if (!line) {
          line = {
            ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0,
            r: 0, g: 0, b: 0, a: 0,
          };
          lines[lineIndex] = line;
        }
        if (wave.plane === 'vertical') {
          line.ax = wave.center[0] + x;
          line.ay = wave.center[1] + z;
          line.az = wave.center[2] + 0.05;
          line.bx = wave.center[0] + nextX;
          line.by = wave.center[1] + nextZ;
          line.bz = wave.center[2] + 0.05;
        } else {
          line.ax = wave.center[0] + x;
          line.ay = wave.center[1] + 0.05;
          line.az = wave.center[2] + z;
          line.bx = wave.center[0] + nextX;
          line.by = wave.center[1] + 0.05;
          line.bz = wave.center[2] + nextZ;
        }
        line.r = wave.color[0];
        line.g = wave.color[1];
        line.b = wave.color[2];
        line.a = alpha;
        lineIndex++;
        x = nextX;
        z = nextZ;
      }
    }
    lines.length = lineIndex;
    return lines;
  }
}
