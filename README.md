# Fancy Card Table v0.7

This revision focuses on making the project feel more like a real game client while improving the tabletop interaction model.

## Highlights

- Better, more polished title screen presentation.
- Larger commander previews in the lobby.
- Player 3 and Player 4 mats now use the same full scale as Player 1 and Player 2.
- Zone proportions adjusted so artifacts / enchantments have proper card-height room.
- Board-card preview popup is larger and easier to read.
- Library is now a 3D-style deck stack that visually shrinks as your deck gets smaller.
- Clicking your library draws a card and plays a flip / fly-to-hand animation.
- Cards already on the board can now be picked up and moved.
- Dragging selected stacks moves the full selected stack together.
- Cards can now be dragged from the board to graveyard / exile / other zones / back to hand / back into the library.
- Sending cards back into the library prompts for top / bottom / random / shuffle.

## Run

```bash
npm install
npm run dev
```

If you are using Supabase features, copy your `.env.local` file into this folder.
