import { describe, expect, it } from "vitest";
import { seatAnimalId, seatAnimalName, spectatorAnimalId, TABLE_SEAT_ANIMALS } from "../../src/avatar/seatRoles.js";

describe("seat animal roles", () => {
  it("walks 3-player chairs counterclockwise: panda, owl, fox", () => {
    expect(seatAnimalId(0, 3)).toBe("panda");
    expect(seatAnimalId(1, 3)).toBe("owl");
    expect(seatAnimalId(2, 3)).toBe("fox");
    expect(seatAnimalName(0, 3)).toBe("熊猫");
    expect(seatAnimalName(1, 3)).toBe("猫头鹰");
    expect(seatAnimalName(2, 3)).toBe("狐狸");
  });

  it("adds rabbit as the last counterclockwise chair", () => {
    expect(TABLE_SEAT_ANIMALS).toEqual(["panda", "owl", "fox", "rabbit"]);
    expect(seatAnimalId(1, 4)).toBe("owl");
    expect(seatAnimalId(2, 4)).toBe("fox");
    expect(seatAnimalId(3, 4)).toBe("rabbit");
    expect(seatAnimalName(3, 4)).toBe("兔子");
  });

  it("marks the rabbit as spectator in 3-player", () => {
    expect(spectatorAnimalId(3)).toBe("rabbit");
    expect(spectatorAnimalId(4)).toBeNull();
  });
});
