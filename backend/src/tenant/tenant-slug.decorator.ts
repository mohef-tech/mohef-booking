import { createParamDecorator, ExecutionContext } from '@nestjs/common';

interface RequestWithHeaders {
  headers: Record<string, string | string[] | undefined>;
}

export const TenantSlug = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<RequestWithHeaders>();
    const rawHeader = request.headers['x-tenant-slug'];
    if (Array.isArray(rawHeader)) {
      return rawHeader[0];
    }
    return rawHeader;
  },
);
