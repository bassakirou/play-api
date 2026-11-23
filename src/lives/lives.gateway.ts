import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { LivesService } from './lives.service';
import { LiveSettingsService } from './live-settings.service';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/lives-ws',
})
export class LivesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(LivesGateway.name);

  // Map liveId -> Set of viewer socket IDs (excluding host)
  private roomViewers: Map<string, Set<string>> = new Map();
  // Map socketId -> liveId
  private socketToRoom: Map<string, string> = new Map();
  // Map liveId -> host socket ID
  private readonly accessTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly peerViewers = new Set<string>();
  private roomHosts: Map<string, string> = new Map();

  constructor(
    private readonly livesService: LivesService,
    private readonly liveSettingsService: LiveSettingsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`[LivesGateway] Client connecté: ${client.id}`);
  }

  private clearAccessTimer(socketId: string) {
    clearTimeout(this.accessTimers.get(socketId));
    this.accessTimers.delete(socketId);
  }

  async handleDisconnect(client: Socket) {
    this.clearAccessTimer(client.id);
    this.peerViewers.delete(client.id);
    const liveId = this.socketToRoom.get(client.id);
    if (liveId) {
      this.socketToRoom.delete(client.id);

      // Check if the disconnecting client was the host
      if (this.roomHosts.get(liveId) === client.id) {
        this.roomHosts.delete(liveId);
        this.logger.log(`[LivesGateway] Hôte déconnecté pour le live ${liveId}`);
        this.server.to(`live_${liveId}`).emit('webrtc:host_left', { liveId });
      }

      const room = this.roomViewers.get(liveId);
      if (room && room.has(client.id)) {
        room.delete(client.id);
        const count = room.size;
        await this.livesService.updateViewerCount(liveId, count);
        this.server.to(`live_${liveId}`).emit('live:viewer_count', {
          liveId,
          viewerCount: count,
        });
        // Notify host that viewer disconnected
        const hostSocketId = this.roomHosts.get(liveId);
        if (hostSocketId) {
          this.server.to(hostSocketId).emit('webrtc:viewer_left', {
            viewerSocketId: client.id,
            liveId,
          });
        }
      }
    }
    this.logger.log(`[LivesGateway] Client déconnecté: ${client.id}`);
  }

  @SubscribeMessage('join_live')
  async handleJoinLive(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { liveId: string; user?: any; isHost?: boolean; token?: string; peerPlayback?: boolean },
  ) {
    const { liveId, isHost, token } = data;
    if (!liveId) return;

    // Validate the socket identity before checking private access or assigning the host.
    let userId: string | undefined;
    const authToken = client.handshake.auth?.accessToken;
    if (typeof authToken === 'string') {
      try {
        const claims = this.jwt.verify<{ sub: string }>(authToken, {
          secret: this.config.get<string>('JWT_SECRET') || 'secretKey',
        });
        userId = claims.sub;
      } catch {
        // Guests can still join public lives or use an invitation.
      }
    }
    let accessEndsAt: Date | null = null;
    try {
      const live = await this.livesService.findOne(liveId, token, undefined, userId, false);
      if (live?.hasPlaybackAccess === false) {
        client.emit('live:error', { message: 'Achetez l’accès à cette session pour la rejoindre.' });
        return;
      }
      if (!live || (isHost && (!userId || live.hostId !== userId))) {
        client.emit('live:error', { message: 'Session Live introuvable.' });
        return;
      }
      accessEndsAt = live.purchaseEndsAt;
    } catch (err: any) {
      client.emit('live:error', {
        message: err?.message || 'Accès refusé. Ce direct est privé.',
      });
      return;
    }

    this.clearAccessTimer(client.id);
    if (!isHost && accessEndsAt) {
      const expire = () => {
        const remaining = accessEndsAt!.getTime() - Date.now();
        if (remaining > 0) {
          this.accessTimers.set(client.id, setTimeout(expire, Math.min(remaining, 2147483647)).unref());
          return;
        }
        client.emit('live:error', { message: 'Votre accès à ce direct a expiré. Renouvelez votre abonnement pour le rejoindre.' });
        client.disconnect();
      };
      if (accessEndsAt.getTime() <= Date.now()) { expire(); return; }
      expire();
    }

    // Leave previous room if any
    const prevRoom = this.socketToRoom.get(client.id);
    if (prevRoom && prevRoom !== liveId) {
      client.leave(`live_${prevRoom}`);
      const oldSet = this.roomViewers.get(prevRoom);
      if (oldSet && oldSet.has(client.id)) {
        oldSet.delete(client.id);
        this.server.to(`live_${prevRoom}`).emit('live:viewer_count', {
          liveId: prevRoom,
          viewerCount: oldSet.size,
        });
      }
      if (this.roomHosts.get(prevRoom) === client.id) {
        this.roomHosts.delete(prevRoom);
      }
    }

    this.peerViewers.delete(client.id);
    client.join(`live_${liveId}`);
    this.socketToRoom.set(client.id, liveId);

    if (isHost) {
      // Host joined: register host socket and do NOT add to viewers count!
      this.roomHosts.set(liveId, client.id);
      this.logger.log(`[LivesGateway] Hôte connecté (${client.id}) pour le live ${liveId}`);

      const currentViewers = this.roomViewers.get(liveId)?.size || 0;
      client.emit('live:viewer_count', {
        liveId,
        viewerCount: currentViewers,
      });
      for (const viewerSocketId of this.roomViewers.get(liveId) ?? []) {
        if (this.peerViewers.has(viewerSocketId)) {
          client.emit('webrtc:viewer_joined', { viewerSocketId, liveId });
        }
      }
      // Notify all current viewers that host is ready
      client.to(`live_${liveId}`).emit('webrtc:host_ready', {
        hostSocketId: client.id,
        liveId,
      });
      return;
    }

    // Viewer joined: check max viewers limit from config
    try {
      const config = await this.liveSettingsService.getConfig();
      const currentCount = this.roomViewers.get(liveId)?.size || 0;
      if (config.maxViewers > 0 && currentCount >= config.maxViewers) {
        client.emit('live:limit_reached', {
          message: `Limite maximale de spectateurs atteinte (${config.maxViewers}).`,
        });
        return;
      }
    } catch {
      // Continue if config check fails
    }

    if (!this.roomViewers.has(liveId)) {
      this.roomViewers.set(liveId, new Set());
    }
    this.roomViewers.get(liveId)!.add(client.id);

    const viewerCount = this.roomViewers.get(liveId)!.size;
    await this.livesService.updateViewerCount(liveId, viewerCount);

    this.server.to(`live_${liveId}`).emit('live:viewer_count', {
      liveId,
      viewerCount,
    });

    if (data.peerPlayback === false) return;
    this.peerViewers.add(client.id);

    // Notify broadcaster/host that a viewer joined (to trigger WebRTC offer)
    const hostSocketId = this.roomHosts.get(liveId);
    if (hostSocketId) {
      this.server.to(hostSocketId).emit('webrtc:viewer_joined', {
        viewerSocketId: client.id,
        user: data.user,
        liveId,
      });
      client.emit('webrtc:host_info', {
        hostSocketId,
        liveId,
      });
    } else {
      // Broadcast to room in case host socket ID isn't mapped yet
      client.to(`live_${liveId}`).emit('webrtc:viewer_joined', {
        viewerSocketId: client.id,
        user: data.user,
        liveId,
      });
    }
  }

  @SubscribeMessage('leave_live')
  async handleLeaveLive(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { liveId: string },
  ) {
    const { liveId } = data;
    if (!liveId) return;

    this.clearAccessTimer(client.id);
    client.leave(`live_${liveId}`);
    this.socketToRoom.delete(client.id);

    if (this.roomHosts.get(liveId) === client.id) {
      this.roomHosts.delete(liveId);
      this.server.to(`live_${liveId}`).emit('webrtc:host_left', { liveId });
    }

    const room = this.roomViewers.get(liveId);
    if (room && room.has(client.id)) {
      room.delete(client.id);
      const viewerCount = room.size;
      await this.livesService.updateViewerCount(liveId, viewerCount);
      this.server.to(`live_${liveId}`).emit('live:viewer_count', {
        liveId,
        viewerCount,
      });
      const hostSocketId = this.roomHosts.get(liveId);
      if (hostSocketId) {
        this.server.to(hostSocketId).emit('webrtc:viewer_left', {
          viewerSocketId: client.id,
          liveId,
        });
      }
    }
  }

  @SubscribeMessage('send_comment')
  async handleSendComment(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      clientMsgId?: string;
      liveId: string;
      userId?: string;
      userName?: string;
      userAvatar?: string;
      role?: string;
      text: string;
    },
  ) {
    if (!data.liveId || !data.text) return;

    try {
      const live = await this.livesService.findOne(data.liveId).catch(() => null);
      if (live && (live.status === 'ENDED' || live.status === 'REPLAY')) {
        client.emit('live:comment_error', {
          message: 'La diffusion est terminée. Les commentaires sont fermés.',
        });
        return;
      }

      const comment = await this.livesService.addComment(
        data.liveId,
        data.userId || null,
        {
          text: data.text,
          userName: data.userName,
          userAvatar: data.userAvatar,
          role: data.role,
        },
      );

      const formatted = {
        id: comment.id,
        clientMsgId: data.clientMsgId,
        streamId: comment.liveId,
        userId: comment.userId,
        userName: comment.userName,
        userAvatar: comment.userAvatar,
        role: comment.role,
        text: comment.text,
        timestamp: comment.createdAt,
      };

      // Broadcast comment to entire room in real-time
      this.server.to(`live_${data.liveId}`).emit('live:new_comment', formatted);
    } catch (err: any) {
      this.logger.error(`[LivesGateway] Erreur addComment: ${err.message}`);
    }
  }

  @SubscribeMessage('send_like')
  async handleSendLike(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { liveId: string; liked: boolean },
  ) {
    if (!data.liveId) return;
    try {
      const result = await this.livesService.toggleLike(data.liveId, data.liked);
      this.server.to(`live_${data.liveId}`).emit('live:likes_count', {
        liveId: data.liveId,
        likesCount: result.likesCount,
      });
    } catch (err: any) {
      this.logger.error(`[LivesGateway] Erreur send_like: ${err.message}`);
    }
  }

  @SubscribeMessage('send_reaction')
  async handleSendReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      liveId: string;
      emoji: string;
      reactionId?: number | string;
    },
  ) {
    if (!data.liveId || !data.emoji) return;

    try {
      await this.livesService.addReaction(data.liveId, data.emoji);

      // Diffuse l'animation aux AUTRES clients de la pièce (l'émetteur l'a déjà affichée instantanément en optimiste)
      client.to(`live_${data.liveId}`).emit('live:new_reaction', {
        id: data.reactionId || Date.now() + Math.random(),
        emoji: data.emoji,
        senderSocketId: client.id,
      });
    } catch (err: any) {
      this.logger.error(`[LivesGateway] Erreur addReaction: ${err.message}`);
    }
  }

  // WebRTC Signaling Handlers (ultra low latency peer-to-peer / broadcaster relay)
  @SubscribeMessage('webrtc:offer')
  handleWebRtcOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetSocketId: string; offer: any; liveId: string },
  ) {
    if (this.socketToRoom.get(client.id) !== data.liveId ||
        this.socketToRoom.get(data.targetSocketId) !== data.liveId) return;
    this.server.to(data.targetSocketId).emit('webrtc:offer', {
      offer: data.offer,
      senderSocketId: client.id,
      liveId: data.liveId,
    });
  }

  @SubscribeMessage('webrtc:answer')
  handleWebRtcAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetSocketId: string; answer: any; liveId: string },
  ) {
    if (this.socketToRoom.get(client.id) !== data.liveId ||
        this.socketToRoom.get(data.targetSocketId) !== data.liveId) return;
    this.server.to(data.targetSocketId).emit('webrtc:answer', {
      answer: data.answer,
      senderSocketId: client.id,
      liveId: data.liveId,
    });
  }

  @SubscribeMessage('webrtc:ice_candidate')
  handleIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetSocketId: string; candidate: any; liveId: string },
  ) {
    if (this.socketToRoom.get(client.id) !== data.liveId ||
        this.socketToRoom.get(data.targetSocketId) !== data.liveId) return;
    this.server.to(data.targetSocketId).emit('webrtc:ice_candidate', {
      candidate: data.candidate,
      senderSocketId: client.id,
      liveId: data.liveId,
    });
  }

  @SubscribeMessage('stream_state')
  handleStreamState(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { liveId: string; state: 'LIVE' | 'ENDED' | 'PAUSED' },
  ) {
    if (this.roomHosts.get(data.liveId) !== client.id) return;
    this.server.to(`live_${data.liveId}`).emit('live:state_change', data);
  }
}
