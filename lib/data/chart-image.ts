import { Extension } from "@tiptap/core";

/**
 * 그래프 이미지(image 노드)에 원본 Dataset id와 차트 설정을 저장하는 속성.
 * 더블클릭 시 이 값으로 그래프 설정을 다시 편집한다 (SPEC 7.3 (e)).
 * HTML로는 data-dataset-id / data-chart 속성으로 오간다.
 */
export const ChartImageAttributes = Extension.create({
  name: "chartImageAttributes",
  addGlobalAttributes() {
    return [
      {
        types: ["image"],
        attributes: {
          datasetId: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-dataset-id"),
            renderHTML: (attrs) => (attrs.datasetId ? { "data-dataset-id": attrs.datasetId } : {}),
          },
          chart: {
            default: null,
            parseHTML: (el) => {
              const raw = el.getAttribute("data-chart");
              if (!raw) return null;
              try {
                return JSON.parse(raw);
              } catch {
                return null;
              }
            },
            renderHTML: (attrs) => (attrs.chart ? { "data-chart": JSON.stringify(attrs.chart) } : {}),
          },
        },
      },
    ];
  },
});
