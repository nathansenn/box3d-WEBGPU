// Exact world checkpoints: the bridge's view of box3d_snapshot.c. See that file.
#ifndef B3W_BOX3D_SNAPSHOT_H
#define B3W_BOX3D_SNAPSHOT_H

#include <box3d/box3d.h>
#include <stdint.h>

/** A malloc'ed image of the world's complete simulation state and the geometry it names, or NULL. *outSize gets its length. */
uint8_t* b3w_snapshot_capture(b3WorldId world, int* outSize);
/** 1 when [data, size) is a well-formed image of this build's format. Touches nothing. */
int b3w_snapshot_check(const uint8_t* data, int size);
/** Overwrite the world with the image. Returns the holder of the geometry the restored shapes borrow (release it with
 * b3w_snapshot_release after the world is destroyed or restored again), or NULL when the image was refused. After a
 * refusal that got past the header the world is unusable and must be destroyed. */
void* b3w_snapshot_restore(b3WorldId world, const uint8_t* data, int size);
void b3w_snapshot_release(void* holder);

#endif
