"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CinematicEffects = void 0;
const math_1 = require("./math");
const EMPTY_SHAKE = { yaw: 0, pitch: 0, targetOffset: [0, 0, 0] };
function add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a, s) {
    return [a[0] * s, a[1] * s, a[2] * s];
}
function hexColor(hex, emissive = 1) {
    return [
        ((hex >> 16) & 0xff) / 255,
        ((hex >> 8) & 0xff) / 255,
        (hex & 0xff) / 255,
        emissive,
    ];
}
class CinematicEffects {
    particles = [];
    shockwaves = [];
    rng = new math_1.LcgRng(0xa11ce);
    shakeEnergy = 0;
    elapsed = 0;
    clear(seed = 0xa11ce) {
        this.particles.length = 0;
        this.shockwaves.length = 0;
        this.rng = new math_1.LcgRng(seed >>> 0);
        this.shakeEnergy = 0;
        this.elapsed = 0;
    }
    particleCount() {
        return this.particles.length;
    }
    spawnExplosion(center, intensity, budget) {
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
            center: [...center],
            radius: 0.4,
            speed: Math.max(8, intensity * 1.45),
            life: 0.95,
            maxLife: 0.95,
            color: [1, 0.72, 0.26, 0.86],
        });
        this.addCameraShake((0, math_1.clamp)(intensity * 0.055, 0.2, 1.4));
    }
    spawnProjectileMuzzle(position, velocity, budget) {
        const direction = (0, math_1.vec3Normalize)(velocity);
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
    }
    spawnImpulseDust(center, strength, budget) {
        const count = Math.min(Math.max(16, Math.round(strength * 3)), Math.max(16, Math.round(budget * 0.35)));
        for (let i = 0; i < count; i++) {
            const angle = this.rng.range(0, Math.PI * 2);
            const dir = [Math.cos(angle), this.rng.range(0.08, 0.42), Math.sin(angle)];
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
        this.addCameraShake((0, math_1.clamp)(strength * 0.025, 0.08, 0.6));
    }
    spawnRainFlash(center, budget) {
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
    }
    addCameraShake(amount) {
        this.shakeEnergy = (0, math_1.clamp)(this.shakeEnergy + amount, 0, 2.2);
    }
    update(dt) {
        const step = (0, math_1.clamp)(dt, 0, 0.05);
        this.elapsed += step;
        const dragScale = step * 60;
        for (const particle of this.particles) {
            particle.life -= step;
            particle.vel[1] -= particle.gravity * step;
            const drag = Math.pow(particle.drag, dragScale);
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
        }
        this.particles = this.particles.filter((particle) => particle.life > 0 && particle.pos[1] > -4);
        for (const wave of this.shockwaves) {
            wave.life -= step;
            wave.radius += wave.speed * step;
        }
        this.shockwaves = this.shockwaves.filter((wave) => wave.life > 0);
        this.shakeEnergy *= Math.pow(0.88, dragScale);
        if (this.shakeEnergy < 0.002)
            this.shakeEnergy = 0;
    }
    cameraShake() {
        if (this.shakeEnergy <= 0)
            return EMPTY_SHAKE;
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
    buildFrame(maxInstances) {
        const count = Math.min(maxInstances, this.particles.length);
        const matrices = new Float32Array(count * 16);
        const colors = new Float32Array(count * 4);
        for (let i = 0; i < count; i++) {
            const particle = this.particles[i];
            const lifeRatio = (0, math_1.saturate)(particle.life / Math.max(0.001, particle.maxLife));
            (0, math_1.writeModelMatrixFromEuler)(matrices, i * 16, particle.pos, particle.rot, particle.half);
            colors[i * 4 + 0] = particle.color[0] * (0.72 + lifeRatio * 0.28);
            colors[i * 4 + 1] = particle.color[1] * (0.72 + lifeRatio * 0.28);
            colors[i * 4 + 2] = particle.color[2] * (0.72 + lifeRatio * 0.28);
            colors[i * 4 + 3] = 1 + Math.max(0, particle.color[3] - 1) * lifeRatio;
        }
        return { matrices, colors, count, debugLines: this.buildShockwaveLines() };
    }
    randomDirection(verticalBias) {
        const v = [this.rng.signed(1), this.rng.signed(1) + verticalBias, this.rng.signed(1)];
        const length = (0, math_1.vec3Length)(v);
        return length > 0.0001 ? [v[0] / length, v[1] / length, v[2] / length] : [0, 1, 0];
    }
    buildShockwaveLines() {
        const lines = [];
        for (const wave of this.shockwaves) {
            const alpha = (0, math_1.saturate)(wave.life / wave.maxLife) * wave.color[3];
            const segments = 72;
            for (let i = 0; i < segments; i++) {
                const a = (i / segments) * Math.PI * 2;
                const b = ((i + 1) / segments) * Math.PI * 2;
                lines.push({
                    ax: wave.center[0] + Math.cos(a) * wave.radius,
                    ay: wave.center[1] + 0.05,
                    az: wave.center[2] + Math.sin(a) * wave.radius,
                    bx: wave.center[0] + Math.cos(b) * wave.radius,
                    by: wave.center[1] + 0.05,
                    bz: wave.center[2] + Math.sin(b) * wave.radius,
                    r: wave.color[0],
                    g: wave.color[1],
                    b: wave.color[2],
                    a: alpha,
                });
            }
        }
        return lines;
    }
}
exports.CinematicEffects = CinematicEffects;
