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
import { Logger } from '@nestjs/common';
import { LivesService } from './lives.service';

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

  // Map liveId -> Set of socket IDs
  private roomViewers: Map<string, Set<string>> = new Map();
  // Map socketId -> liveId
  private socketToRoom: Map<string, string> = new Map();

  constructor(private readonly livesService: LivesService) {}

  handleConnection(client: Socket) {
    this.logger.log(`[LivesGateway] Client connecté: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    const liveId = this.socketToRoom.get(client.id);
    if (liveId) {
      const room = this.roomViewers.get(liveId);
      if (room) {
        room.delete(client.id);
        const count = room.size;
        this.socketToRoom.delete(client.id);
        await this.livesService.updateViewerCount(liveId, count);
        this.server.to(`live_${liveId}`).emit('live:viewer_count', {
          liveId,
          viewerCount: count,
        });
      }
    }
    this.logger.log(`[LivesGateway] Client déconnecté: ${client.id}`);
  }

  @SubscribeMessage('join_live')
  async handleJoinLive(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { liveId: string; user?: any },
  ) {
    const { liveId } = data;
    if (!liveId) return;

    // Leave previous room if any
    const prevRoom = this.socketToRoom.get(client.id);
    if (prevRoom && prevRoom !== liveId) {
      client.leave(`live_${prevRoom}`);
      const oldSet = this.roomViewers.get(prevRoom);
      if (oldSet) {
        oldSet.delete(client.id);
        this.server.to(`live_${prevRoom}`).emit('live:viewer_count', {
          liveId: prevRoom,
          viewerCount: oldSet.size,
        });
      }
    }

    client.join(`live_${liveId}`);
    this.socketToRoom.set(client.id, liveId);

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

    // Notify broadcaster that a viewer joined (for WebRTC peer connection)
    client.to(`live_${liveId}`).emit('webrtc:viewer_joined', {
      viewerSocketId: client.id,
      user: data.user,
    });
  }

  @SubscribeMessage('leave_live')
  async handleLeaveLive(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { liveId: string },
  ) {
    const { liveId } = data;
    if (!liveId) return;

    client.leave(`live_${liveId}`);
    this.socketToRoom.delete(client.id);

    const room = this.roomViewers.get(liveId);
    if (room) {
      room.delete(client.id);
      const viewerCount = room.size;
      await this.livesService.updateViewerCount(liveId, viewerCount);
      this.server.to(`live_${liveId}`).emit('live:viewer_count', {
        liveId,
        viewerCount,
      });
    }
  }

  @SubscribeMessage('send_comment')
  async handleSendComment(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
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

  @SubscribeMessage('send_reaction')
  async handleSendReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { liveId: string; emoji: string },
  ) {
    if (!data.liveId || !data.emoji) return;

    try {
      await this.livesService.addReaction(data.liveId, data.emoji);

      // Broadcast burst animation trigger
      this.server.to(`live_${data.liveId}`).emit('live:new_reaction', {
        id: Date.now() + Math.random(),
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
    this.server.to(`live_${data.liveId}`).emit('live:state_change', data);
  }
}
