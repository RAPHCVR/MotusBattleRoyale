import type { GameTokenClaims, RoomKind } from "@motus/protocol";

import { BaseMotusRoom } from "./BaseMotusRoom.js";

export class PrivateLobbyRoom extends BaseMotusRoom {
  protected readonly roomKind: RoomKind = "private";

  static async onAuth(token: string): Promise<GameTokenClaims> {
    return BaseMotusRoom.onAuth(token);
  }
}
