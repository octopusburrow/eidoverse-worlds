// Isolate unrelated UI/net services while running the actual /touch and
// /letgo registry handlers, reachnet descriptor path and Avatar methods.
import {mock} from 'bun:test';
import {fileURLToPath} from 'node:url';
export async function commandsFor(getMe:()=>any, messages:string[]) {
  const noop=()=>{};
  // base.js is short of names its real importers use (tee, angleDelta): that works only because reach-frame-fixture
  // loads the real avatar.js (and with it base.js) first, and bun patches an already-loaded module's exports in place.
  // Import this fixture before reach-frame-fixture and it breaks the way ui.js did.
  const modules:any={
    'base.js':{CONFIG:{name:'owner'},bus:{on:noop,emit:noop},report:noop},
    'capture.js':{captureFrame:noop},
    'world.js':{entities:new Map(),roleOf:noop,worldHasOwner:()=>false},
    'net.js':{net:{myId:'owner'},sendVerb:noop,sendMod:noop,sendPuppet:noop,sendWorldFork:noop,sendWorldReset:noop,requestDebug:noop},
    'remotes.js':{remotes:new Map()},
    'controller.js':{myState:{pos:{x:0,y:0,z:0}},setPosture:noop,flightReport:()=>''},
    'physobj.js':{kick:noop},'chat.js':{logChat:(_who:string,text:string)=>messages.push(text)},
    // makeSection: stylepanel.js imports it, and handlers.js imports stylepanel.js (for panelAlpha). A mocked module
    // that isn't loaded yet must carry EVERY name its importers ask for, or bun refuses the import and the test never
    // runs. Named one by one on purpose, so a new UI dependency in the command path still fails here, loudly.
    'ui.js':{toggleHelp:noop,flashHint:noop,makeSection:noop},'scenegraph.js':{sceneAttach:noop,sceneDetach:noop},
    'consent.js':{setPushable:noop,pushable:()=>false},'localbody.js':{trySitOn:noop},'mybody.js':{getMe},
  };
  for(const [name,exports] of Object.entries(modules))mock.module(fileURLToPath(new URL('../client/lib/'+name,import.meta.url)),()=>exports as any);
  await import('../client/lib/commands/handlers.js');
  return (await import('../client/lib/commands/registry.js')).dispatch;
}
