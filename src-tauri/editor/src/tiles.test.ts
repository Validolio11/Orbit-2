// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { nextTile } from "./components/tiles";
import { filterScripts, samePath } from "./components/PathPickers";

// Lays out tiles at fixed boxes: rows of `columns`, with a heading pushing the second group down.
function grid(rows: number[][]) {
  const list = document.createElement("div");
  const tiles: HTMLElement[] = [];
  rows.forEach((row, r) => row.forEach((left) => {
    const tile = document.createElement("button");
    tile.dataset.tile = "";
    tile.getBoundingClientRect = () => ({ top: r * 100, left, width: 80, height: 80, right: left + 80, bottom: r * 100 + 80, x: left, y: r * 100, toJSON() {} });
    list.append(tile); tiles.push(tile);
  }));
  return { list, tiles };
}

describe("tile keyboard movement", () => {
  it("moves by on-screen rows even when groups leave a short row", () => {
    // Row 0 has three tiles, row 1 (a new group) has one, row 2 has three.
    const { list, tiles } = grid([[0, 100, 200], [0], [0, 100, 200]]);
    expect(nextTile(list, tiles[2], "ArrowDown")).toBe(tiles[3]);
    expect(nextTile(list, tiles[3], "ArrowDown")).toBe(tiles[4]);
    expect(nextTile(list, tiles[5], "ArrowUp")).toBe(tiles[3]);
    expect(nextTile(list, tiles[1], "ArrowUp")).toBeNull();
    expect(nextTile(list, tiles[3], "ArrowLeft")).toBe(tiles[2]);
    expect(nextTile(list, tiles[0], "End")).toBe(tiles[6]);
    expect(nextTile(list, tiles[6], "ArrowRight")).toBeNull();
  });
  it("skips disabled tiles", () => {
    const { list, tiles } = grid([[0, 100, 200]]);
    tiles[1].setAttribute("disabled", "");
    expect(nextTile(list, tiles[0], "ArrowRight")).toBe(tiles[2]);
  });
});

describe("path helpers", () => {
  it("compares Windows paths without case or trailing separators", () => {
    expect(samePath("C:\\Users\\Me\\", "c:\\users\\me")).toBe(true);
    expect(samePath("", "")).toBe(false);
    expect(samePath("C:\\a", "C:\\ab")).toBe(false);
  });
  it("filters scripts by every word across name, extension and folder", () => {
    const scripts = [
      { name: "backup", path: "a", extension: "ps1", folder: "Desktop" },
      { name: "rename", path: "b", extension: "py", folder: "Documents" },
    ];
    expect(filterScripts(scripts, "").map((s) => s.name)).toEqual(["backup", "rename"]);
    expect(filterScripts(scripts, ".py").map((s) => s.name)).toEqual(["rename"]);
    expect(filterScripts(scripts, "desk BACK").map((s) => s.name)).toEqual(["backup"]);
    expect(filterScripts(scripts, "zzz")).toEqual([]);
  });
});
