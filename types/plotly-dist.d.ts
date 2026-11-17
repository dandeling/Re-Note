// plotly.js-cartesian-dist-min은 타입을 제공하지 않으므로 @types/plotly.js의 타입을 그대로 쓴다.
declare module "plotly.js-cartesian-dist-min" {
  import * as Plotly from "plotly.js";
  export = Plotly;
}
