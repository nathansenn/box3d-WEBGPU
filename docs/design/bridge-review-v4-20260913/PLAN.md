# Bridge review enhancement

Task: 01a07e7b-23c9-72e1-a62e-b780ac76623f. Review the current bridge scene and add useful failure-inspection and comparison workflow, guided by a new imagegen reference. Preserve existing geometry, authored solver semantics, URL settings and concurrent work.

Browser exception: the check requires the private localhost app and native WebGPU/WebGL rendering, including live solver/replay interactions. The prior private build transfer rejection prevents transferring this build to Browserless. Use one disposable owned native IAB tab, no remote transfers, no user-tab changes or retained-tab marks. End the exception when desktop/phone and compiled-build checks are complete; close the owned tab and reset viewport overrides. Every server binds 127.0.0.1.

Initial disk headroom: 64 GiB, above the shared 50 GiB reserve. Shared dirty main is preserved; no commit, push, deployment or bulk cleanup is part of this task.
