# Harness Studio

An open-source, browser-based wire harness CAD tool. You draw the electrical schematic, lay out the physical bundles, and get the connections table, wiring tables, validation and bill of materials (BOM) from the same document. It reads and writes the `.harness` v1.3 JSON format.

```bash
cd harness-studio
npm install
npm run dev        # editor at http://localhost:5173
npm test           # model tests
npm run build      # static build in dist/
```

The editor opens with a demo harness. Your work is autosaved in the browser. Use **File → Save .harness** to keep a copy on disk.

## Views

| View | What it is for |
| --- | --- |
| **Schematic** (1) | Connectors, terminals, splices, diodes, resistors, wires, cables and twisted pairs. |
| **Layout** (2) | Physical bundles, branch points, lengths, coverings, mates and cross sections. |
| **Connections** (3) | Every wire, core and shield, with signals, colour, gauge, routed length and status. |
| **Parts** (4) | The parts library, connector configurations and the BOM. |

### Schematic

- **Adding things:** use the palette, or right-click the canvas.
- **Drawing wires:** drag from a cavity, terminal or inline handle to another handle. Drop on a cable core's end to wire that core.
- **Moving connections:** Ctrl/Cmd-drag from a handle moves all its connections to another handle.
- **Signals:** double-click a cavity to type its signal. Tab moves to the next cavity. Pasting a column of lines fills consecutive cavities.
- **Signal propagation:** signals carry along wires, through splices and across mates, unless a cavity has propagation turned off. Cavities can also be marked as a *global signal*, which joins every endpoint with the same name.
- **Waypoints:** double-click a wire to add a waypoint, and double-click a waypoint to remove it.
- **Grouping wires:** select several wires to turn them into a cable, twist them together, or splice them.
- **Selection:** Shift-drag marquee-selects. **S** selects the whole electrical net.

### Layout

- **Bundles:** drag from a node handle to draw a bundle. Double-click a bundle to add a layout point.
- **Branch points:** drag a layout point onto a branch point to split the bundle there. Drag one branch point onto another to merge them.
- **Mates:** Shift-drag between connectors (or from a ring terminal onto a connector) to mate them.
- **Bundle lengths:** a length can be a calculation such as `40 + 30 + 40`, `5' 3"`, `(10 + 20) cm` or `2 x 150`.
- **Unset lengths:** a bundle without a length is estimated from its drawn length and flagged as *estimated*.
- **Coverings:** they colour the bundle and appear in the cross section and the BOM.

### Wire routing and lengths

Each wire is routed along the shortest path through the bundle graph between the physical locations of its two ends.

- **Inline components:** splices, diodes and resistors sit at the node that minimises total wire length, unless you give them a location.
- **Unreachable wires** are reported as **NO ROUTE**.

## Validation

Validation runs continuously. Its results appear as warning badges on the canvas and in the inspector when nothing is selected.

- **Connector and part checks:** cavity count against the part, shell presence, N/C cavities that are wired, contact and terminal gauge range, and terminal type.
- **Wiring checks:** splice wire count and gauge, open ends, self loops, wires without parts, and wire colour against the part.
- **Layout checks:** no route, missing layout placement, and covering size against bundle diameter.
- **Mate checks:** cavity count, gender, terminal-to-cavity sizes, and duplicate mates.

## Parts library

Parts can be wires, cables (with cores and shield), connectors, contacts, terminals, splices, diodes, resistors, coverings and accessories (locks, dust covers, backshells, boots, seals, plugs, mounts).

- **Configurations:** connector, terminal and splice parts can have configurations. A configuration adds accessories and sets which contact or plug goes in each cavity, filtered by wire gauge.
- **Overrides:** individual cavities can override the contact.
- **Libraries:** a parts library can be exported as a `.harnesslib` file and imported into another harness.

## Component IDs

Components get IDs such as C1, T2, W3, CB1, S1, D1, R1, B4 and BP2.

- **By canvas position** (the default): left to right, then top to bottom.
- **Static:** set in **Settings**. IDs stay fixed when components move, and new items take the next number.

## Command line

The CLI uses the same model as the editor. It suits scripts, CI and AI agents that edit `.harness` files directly.

```bash
npm run cli -- info my.harness
npm run cli -- validate my.harness          # exits 1 when there are errors
npm run cli -- connections my.harness --csv
npm run cli -- wiring my.harness ECU
npm run cli -- nets my.harness --json
npm run cli -- bom my.harness
npm run cli -- format my.harness            # rewrite in canonical v1.3 form
npm run cli -- demo demo.harness
```

## The `.harness` format

The file is JSON with `version: "1.3"` and these parts:

- **Settings:** `currency`, `lengthUnit`, `gaugeUnit`, `readOnly`, `idNumbers`.
- **Component arrays:** `connectors`, `terminals`, `splices`, `diodes`, `resistors`, `wires`, `cables`, `twistedWires`, `bundles`, `branchPoints`, `mates`, `schematicNotes`, `layoutNotes`, `groups`.
- **Part arrays:** one per part kind (`wireParts`, `connectorParts`, …).

Rules:

- **Ids** are unique across the document.
- **Positions** use a 30-unit grid, with separate `schematicPosition` and `layoutPosition`.
- **Wire ends** reference `{ id, handle }`. The handle is a cavity id, `Terminal`, `Splice`, `Left` or `Right`.
- **Groups** contain their own arrays. References inside a group use `<groupId>-<localId>`.
- **Unknown fields** are preserved on save.

## Project layout

```
src/model/     format IO, units, nets/routing analysis, validation, BOM, editing operations
src/ui/        React views, inspector, canvas, menus
src/samples/   demo harness
cli/           command line tool
tests/         model tests and a fixture from the format documentation
```
