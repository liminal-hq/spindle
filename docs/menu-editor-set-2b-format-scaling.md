# Menu Editor Set 2b Format Scaling and Hardware Reality

## Strategic Context

The Spindle project targets Blu-ray (HDMV with Interactive Graphics/IG) as the primary authoring ceiling, and DVD (or VCD) as the graceful degradation floor. This approach shifts our design philosophy from "build for the lowest common denominator" to "design for premium and downsample gracefully."

## 1. The Blu-ray Baseline
Yuli's Set 2b designs, particularly the `Button Style` and `Text Style` panels, are completely valid under the Blu-ray specification. HDMV Interactive Graphics streams can handle:
- 8-bit color depth
- 256 levels of alpha transparency
- Rich interactive states (Focus and Activate)
- Complex visual effects like soft drop shadows and glowing borders

## 2. Graceful Degradation (The Preview Compass)
If DVD is the floor, the interface must honestly manage the constraints.
- **Format-Aware Interface:** When a user specifies they are authoring only for DVD, the UI should gracefully fold away 8-bit alpha controls and present the 4-color CLUT (Color Look-Up Table).
- **The Compile Preview Overlay:** When authoring for "Blu-ray + DVD Fallback", the `Compile Preview` overlay becomes the most vital compass in the application. Toggled via the `P` key, this overlay must show the user precisely how their rich Blu-ray UI will be downsampled (dithered into harsh blocks or flattened) when compiled to DVD subpictures. It translates BD ambition into DVD reality.

## 3. Seamless Branching for UI States (The Timecode Jump Illusion)
To achieve modern, fluid UI states on constrained optical formats, Spindle will employ seamless branching and multiplexed Button Over Video (BOV).
- **The Magic Trick:** By jumping the playhead to a different timecode in the background multiplex when a button is pressed, we can simulate "transitions."
- **The Mechanical Reality:** This requires incredible precision with I-frame alignment. A timecode jump requires the laser to physically move across the platter. If jumps are not authored perfectly on sector boundaries, the user will experience a half-second black screen and a mechanical "clunk" instead of a fluid transition. Our multiplexing engine must be flawless.

## 4. SPRM Management and the Workspace
The auto-generated menus feature actions like `setAudioStream` and `setSubtitleStream`.
- **The User Experience:** The UI makes this look like a simple dropdown, hiding the complexity. This is the correct approach for the majority of users.
- **The Under-the-Hood Reality:** Spindle must write `SetSystemStream` instructions to SPRM 1 and SPRM 2 in the virtual machine. The compiler logic must be ready to handle these new VM instructions before they are exposed.
- **Advanced Scripting Mode:** We should reserve architectural space for a low-level scripting "advanced mode" (a trapdoor in the basement) where power users can manually manipulate player registers, but this is an extension beyond the v1 workspace.
