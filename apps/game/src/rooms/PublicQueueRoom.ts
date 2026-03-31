import type { GameTokenClaims, RoomKind } from "@motus/protocol";

import { BaseMotusRoom } from "./BaseMotusRoom.js";

export class PublicQueueRoom extends BaseMotusRoom {
  protected readonly roomKind: RoomKind = "public";

  static async onAuth(token: string): Promise<GameTokenClaims> {
    return BaseMotusRoom.onAuth(token);
  }
}
