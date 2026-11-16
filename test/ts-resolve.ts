// Lets `node --test` run the sources as they are: their `./x.js` imports name `./x.ts` files.
import { registerHooks } from 'node:module'

registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && spec.endsWith('.js')) return next(spec.slice(0, -3) + '.ts', ctx)
      throw e
    }
  },
})
