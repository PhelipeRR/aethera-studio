import { app, desktopCapturer, session, shell } from 'electron';
import { EXTERNAL_HOST_ALLOWLIST, isAllowedExternalUrl, isAllowedPermission, isAllowedSystemAudio, isAppUrl, type AppLocation } from './navigation.js';

let systemAudioArmed = false;

/** Opened by the meeting that listens, and closed with it. */
export function armSystemAudio(armed: boolean): void { systemAudioArmed = armed; }

/** Applies process-wide guards. Call once, before any window is created. */
export function hardenApp(location: AppLocation): void {
  app.on('web-contents-created', (_event, contents) => {
    const blockForeignNavigation = (event: Electron.Event, url: string): void => {
      if (!isAppUrl(url, location)) event.preventDefault();
    };
    contents.on('will-navigate', blockForeignNavigation);
    contents.on('will-redirect', blockForeignNavigation);
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url, EXTERNAL_HOST_ALLOWLIST)) void shell.openExternal(url);
      return { action: 'deny' };
    });
  });

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
      callback(isAllowedSystemAudio(permission, contents.getURL(), location, systemAudioArmed, 'mediaTypes' in details ? details.mediaTypes ?? [] : []) || isAllowedPermission(permission, contents.getURL(), location, 'mediaTypes' in details ? details.mediaTypes ?? [] : [])),
    );
    session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => isAllowedSystemAudio(permission, contents?.getURL(), location, systemAudioArmed, details.mediaType && details.mediaType !== 'unknown' ? [details.mediaType] : []) || isAllowedPermission(permission, contents?.getURL(), location, details.mediaType ? [details.mediaType] : []));
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      if (!isAllowedSystemAudio('display-capture', request.frame?.url, location, systemAudioArmed)) { callback(null as never); return; }
      void desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).then(([screen]) => callback(screen ? { video: screen, audio: 'loopback' } : null as never), () => callback(null as never));
    });
  });
}
