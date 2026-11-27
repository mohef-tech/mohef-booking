import { Injectable, type MessageEvent } from '@nestjs/common';
import {
  filter,
  interval,
  map,
  merge,
  of,
  Subject,
  type Observable,
} from 'rxjs';
import type { RealtimeBookingEvent } from './realtime.types.js';

@Injectable()
export class RealtimeEventsService {
  private readonly events$ = new Subject<RealtimeBookingEvent>();

  emit(payload: RealtimeBookingEvent): void {
    this.events$.next(payload);
  }

  streamForTenant(tenantId: string): Observable<MessageEvent> {
    return merge(
      of<MessageEvent>({ comment: 'connected' }),
      this.events$.pipe(
        filter((event) => event.tenantId === tenantId),
        map(
          (event): MessageEvent => ({
            type: event.event,
            data: event,
          }),
        ),
      ),
      interval(20_000).pipe(
        map((): MessageEvent => ({ comment: 'keep-alive' })),
      ),
    );
  }
}
