// Node 20.19+ supports module.register, including in workers spawned with --import.
import {register} from 'node:module';
register('./typescript-loader.mjs', import.meta.url);
