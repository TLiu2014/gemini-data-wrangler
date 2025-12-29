import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import Plot from 'react-plotly.js';

interface Props {
  data: any[];
  config: {
    type: string;
    xAxis: string;
    yAxis: string;
    zAxis?: string;
  } | null;
}

export function EnhancedVisualizations({ data, config }: Props) {
  const d3Container = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!config || !data.length || !d3Container.current) return;

    // Clear previous content
    d3.select(d3Container.current).selectAll('*').remove();

    const width = 800;
    const height = 400;
    const margin = { top: 20, right: 20, bottom: 60, left: 60 };

    const svg = d3.select(d3Container.current)
      .attr('width', width)
      .attr('height', height);

    const xAxis = config.xAxis;
    const yAxis = config.yAxis;

    // Extract numeric values
    const xValues = data.map(d => {
      const val = d[xAxis];
      return typeof val === 'number' ? val : parseFloat(val) || 0;
    });
    const yValues = data.map(d => {
      const val = d[yAxis];
      return typeof val === 'number' ? val : parseFloat(val) || 0;
    });

    const xScale = d3.scaleLinear()
      .domain(d3.extent(xValues) as [number, number])
      .range([margin.left, width - margin.right]);

    const yScale = d3.scaleLinear()
      .domain(d3.extent(yValues) as [number, number])
      .range([height - margin.bottom, margin.top]);

    // Add axes
    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(xScale))
      .append('text')
      .attr('x', width / 2)
      .attr('y', 40)
      .attr('fill', 'black')
      .style('text-anchor', 'middle')
      .text(xAxis);

    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .call(d3.axisLeft(yScale))
      .append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -40)
      .attr('x', -height / 2)
      .attr('fill', 'black')
      .style('text-anchor', 'middle')
      .text(yAxis);

    // Draw based on chart type
    if (config.type === 'scatter' || config.type === 'd3-scatter') {
      svg.selectAll('circle')
        .data(data)
        .enter()
        .append('circle')
        .attr('cx', d => xScale(typeof d[xAxis] === 'number' ? d[xAxis] : parseFloat(d[xAxis]) || 0))
        .attr('cy', d => yScale(typeof d[yAxis] === 'number' ? d[yAxis] : parseFloat(d[yAxis]) || 0))
        .attr('r', 4)
        .attr('fill', '#8884d8')
        .attr('opacity', 0.6);
    } else if (config.type === 'd3-line') {
      const line = d3.line<number>()
        .x((_, i) => xScale(xValues[i]))
        .y((_, i) => yScale(yValues[i]))
        .curve(d3.curveMonotoneX);

      svg.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#8884d8')
        .attr('stroke-width', 2)
        .attr('d', line(data.map((_, i) => i)));
    } else if (config.type === 'd3-bar') {
      const barWidth = (width - margin.left - margin.right) / data.length;
      
      svg.selectAll('rect')
        .data(data)
        .enter()
        .append('rect')
        .attr('x', (_, i) => xScale(xValues[i]) - barWidth / 2)
        .attr('y', d => yScale(typeof d[yAxis] === 'number' ? d[yAxis] : parseFloat(d[yAxis]) || 0))
        .attr('width', barWidth * 0.8)
        .attr('height', d => height - margin.bottom - yScale(typeof d[yAxis] === 'number' ? d[yAxis] : parseFloat(d[yAxis]) || 0))
        .attr('fill', '#8884d8');
    }
  }, [data, config, d3Container]);

  // 3D visualization using Plotly
  if (config?.type === '3d-scatter' && config.zAxis) {
    const xValues = data.map(d => {
      const val = d[config.xAxis];
      return typeof val === 'number' ? val : parseFloat(val) || 0;
    });
    const yValues = data.map(d => {
      const val = d[config.yAxis];
      return typeof val === 'number' ? val : parseFloat(val) || 0;
    });
    const zValues = data.map(d => {
      const val = d[config.zAxis!];
      return typeof val === 'number' ? val : parseFloat(val) || 0;
    });

    return (
      <div style={{ height: '500px', width: '100%', marginTop: '20px', padding: '20px', background: 'white', border: '1px solid #eee', borderRadius: '8px' }}>
        <h4 style={{ textAlign: 'center', margin: '0 0 10px 0' }}>
          3D Scatter: {config.yAxis} vs {config.xAxis} vs {config.zAxis}
        </h4>
        <Plot
          data={[
            {
              x: xValues,
              y: yValues,
              z: zValues,
              type: 'scatter3d',
              mode: 'markers',
              marker: {
                size: 5,
                color: zValues,
                colorscale: 'Viridis',
                showscale: true
              }
            }
          ]}
          layout={{
            title: '',
            scene: {
              xaxis: { title: config.xAxis },
              yaxis: { title: config.yAxis },
              zaxis: { title: config.zAxis }
            },
            margin: { l: 0, r: 0, t: 0, b: 0 },
            height: 450
          }}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    );
  }

  // 3D Surface plot
  if (config?.type === '3d-surface' && config.zAxis) {
    // Create a grid for surface plot (simplified - would need proper grid data)
    const xValues = data.map(d => {
      const val = d[config.xAxis];
      return typeof val === 'number' ? val : parseFloat(val) || 0;
    });
    const yValues = data.map(d => {
      const val = d[config.yAxis];
      return typeof val === 'number' ? val : parseFloat(val) || 0;
    });
    const zValues = data.map(d => {
      const val = d[config.zAxis!];
      return typeof val === 'number' ? val : parseFloat(val) || 0;
    });

    return (
      <div style={{ height: '500px', width: '100%', marginTop: '20px', padding: '20px', background: 'white', border: '1px solid #eee', borderRadius: '8px' }}>
        <h4 style={{ textAlign: 'center', margin: '0 0 10px 0' }}>
          3D Surface: {config.zAxis} over {config.xAxis} and {config.yAxis}
        </h4>
        <Plot
          data={[
            {
              x: xValues,
              y: yValues,
              z: zValues,
              type: 'scatter3d',
              mode: 'markers',
              marker: {
                size: 5,
                color: zValues,
                colorscale: 'Plasma',
                showscale: true
              }
            }
          ]}
          layout={{
            title: '',
            scene: {
              xaxis: { title: config.xAxis },
              yaxis: { title: config.yAxis },
              zaxis: { title: config.zAxis }
            },
            margin: { l: 0, r: 0, t: 0, b: 0 },
            height: 450
          }}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    );
  }

  // D3.js 2D visualizations
  if (config?.type?.startsWith('d3-')) {
    return (
      <div style={{ height: '400px', width: '100%', marginTop: '20px', padding: '20px', background: 'white', border: '1px solid #eee', borderRadius: '8px' }}>
        <h4 style={{ textAlign: 'center', margin: '0 0 10px 0' }}>
          D3.js {config.type.replace('d3-', '')}: {config.yAxis} by {config.xAxis}
        </h4>
        <svg ref={d3Container} style={{ width: '100%', height: '100%' }} />
      </div>
    );
  }

  return null;
}

