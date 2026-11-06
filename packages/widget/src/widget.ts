// Entry for dist/widget.js, the one-script-tag embed:
//   <script src="https://<host>/widget.js"></script>
//   <dues-checkout amount="25" to="ada.near"></dues-checkout>
import { DuesCheckout, defineDuesCheckout } from './element';

defineDuesCheckout();
(globalThis as { DuesCheckout?: typeof DuesCheckout }).DuesCheckout = DuesCheckout;
