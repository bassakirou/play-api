import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { ArtistsModule } from './artists/artists.module';
import { AlbumsModule } from './albums/albums.module';
import { SongsModule } from './songs/songs.module';
import { GenresModule } from './genres/genres.module';
import { PermissionsModule } from './permissions/permissions.module';
import { HealthController } from './health.controller';
import { FilesController } from './files/files.controller';
import { StorageModule } from './storage/storage.module';
import { AuthModule } from './auth/auth.module';
import { ArtistGroupsModule } from './artist-groups/artist-groups.module';
import { MailModule } from './mail/mail.module';
import { PlaylistsModule } from './playlists/playlists.module';
import { SearchModule } from './search/search.module';
import { MaintenanceSubscriptionsModule } from './maintenance-subscriptions/maintenance-subscriptions.module';
import { VideosModule } from './videos/videos.module';
import { VideoPlaylistsModule } from './video-playlists/video-playlists.module';
import { MigrationModule } from './migration/migration.module';
import { StatsModule } from './stats/stats.module';
import { AudiobooksModule } from './audiobooks/audiobooks.module';
import { MediaModule } from './media/media.module';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { LivesModule } from './lives/lives.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    StorageModule,
    AuthModule,
    MailModule,
    UsersModule,
    RolesModule,
    ArtistsModule,
    ArtistGroupsModule,
    AlbumsModule,
    SongsModule,
    GenresModule,
    PermissionsModule,
    PlaylistsModule,
    SearchModule,
    MaintenanceSubscriptionsModule,
    VideosModule,
    VideoPlaylistsModule,
    MigrationModule,
    StatsModule,
    AudiobooksModule,
    MediaModule,
    LivesModule,
  ],
  controllers: [AppController, HealthController, FilesController],
  providers: [AppService],
})
// Trigger play-api sync & vercel deploy
export class AppModule { }
