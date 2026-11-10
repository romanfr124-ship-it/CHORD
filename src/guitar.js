// String order is low E to high e. -1 means muted; 0 means open.
const STANDARD_TUNING = [40,45,50,55,59,64];
const COMMON_SHAPES = {
  "C":[-1,3,2,0,1,0], "Cm":[-1,3,5,5,4,3], "C7":[-1,3,2,3,1,0], "Cmaj7":[-1,3,2,0,0,0],
  "D":[-1,-1,0,2,3,2], "Dm":[-1,-1,0,2,3,1], "D7":[-1,-1,0,2,1,2], "Dmaj7":[-1,-1,0,2,2,2],
  "E":[0,2,2,1,0,0], "Em":[0,2,2,0,0,0], "E7":[0,2,0,1,0,0], "Em7":[0,2,0,0,0,0],
  "F":[1,3,3,2,1,1], "Fm":[1,3,3,1,1,1], "Fmaj7":[1,3,3,2,1,0], "F7":[1,3,1,2,1,1],
  "G":[3,2,0,0,0,3], "Gm":[3,5,5,3,3,3], "G7":[3,2,0,0,0,1], "Gmaj7":[3,2,0,0,0,2],
  "A":[-1,0,2,2,2,0], "Am":[-1,0,2,2,1,0], "A7":[-1,0,2,0,2,0], "Am7":[-1,0,2,0,1,0],
  "B":[-1,2,4,4,4,2], "Bm":[-1,2,4,4,3,2], "B7":[-1,2,1,2,0,2], "Bm7":[-1,2,0,2,0,2]
};
const STRING_NAMES = ["E","A","D","G","B","e"];

export function getSuggestedShape(chordName) {
  return COMMON_SHAPES[chordName] ? [...COMMON_SHAPES[chordName]] : null;
}

export function renderFretboard(container, shape) {
  container.replaceChildren();
  if (!shape) {
    container.textContent = "No stored fingering for this chord yet.";
    container.className = "empty-state";
    return;
  }
  container.className = "fretboard";
  shape.forEach((position, stringIndex) => {
    const column = document.createElement("div");
    column.className = "string-column";
    const label = document.createElement("div");
    label.className = "string-name";
    label.textContent = STRING_NAMES[stringIndex];
    column.append(label);
    for (let fret = 0; fret <= 5; fret++) {
      const cell = document.createElement("div");
      cell.className = "fret-cell";
      if (position === 0 && fret === 0) {
        cell.classList.add("open");
        cell.textContent = "O";
      } else if (position === -1 && fret === 0) {
        cell.textContent = "×";
      } else if (position === fret && fret > 0) {
        cell.classList.add("marked");
        cell.textContent = "●";
      } else {
        cell.textContent = fret === 0 ? "—" : "";
      }
      column.append(cell);
    }
    container.append(column);
  });
}

export function renderTab(container, shape) {
  if (!shape) {
    container.textContent = "No suggested tab available.";
    return;
  }
  container.textContent = STRING_NAMES.map((name, index) => {
    const fret = shape[index] < 0 ? "x" : String(shape[index]);
    return name + "|" + fret + "|";
  }).reverse().join("\n");
}