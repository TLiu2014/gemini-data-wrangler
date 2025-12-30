import { 
  BarChart, Bar, 
  LineChart, Line, 
  AreaChart, Area,
  ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';

interface Props {
  data: any[];
  config: {
    type: string;
    xAxis: string;
    yAxis: string;
  } | null;
}

export function DynamicChart({ data, config }: Props) {
  if (!config || config.type === 'none' || data.length === 0) return null;

  // Validate axes exist in data
  if (!config.xAxis || !config.yAxis) {
    return <div style={{ padding: '20px', background: '#fee2e2', borderRadius: '8px', color: '#991b1b', marginTop: '20px' }}>Missing axis configuration. Please select X and Y axes.</div>;
  }

  // Check if axes exist in first row
  if (data.length > 0 && (!data[0].hasOwnProperty(config.xAxis) || !data[0].hasOwnProperty(config.yAxis))) {
    return <div style={{ padding: '20px', background: '#fee2e2', borderRadius: '8px', color: '#991b1b', marginTop: '20px' }}>Selected axes not found in data. Please check your axis selections.</div>;
  }

  const renderChart = () => {
    const commonChildren = (
      <>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={config.xAxis} />
        <YAxis />
        <Tooltip />
        <Legend />
      </>
    );

    switch (config.type) {
      case 'line':
        return (
          <LineChart data={data}>
            {commonChildren}
            <Line type="monotone" dataKey={config.yAxis} stroke="#8884d8" strokeWidth={2} />
          </LineChart>
        );
      case 'area':
        return (
          <AreaChart data={data}>
            {commonChildren}
            <Area type="monotone" dataKey={config.yAxis} stroke="#8884d8" fill="#8884d8" fillOpacity={0.6} />
          </AreaChart>
        );
      case 'scatter':
        return (
          <ScatterChart data={data}>
            {commonChildren}
            <Scatter name={config.yAxis} dataKey={config.yAxis} fill="#8884d8" />
          </ScatterChart>
        );
      case 'bar':
      default:
        return (
          <BarChart data={data}>
            {commonChildren}
            <Bar dataKey={config.yAxis} fill="#8884d8" />
          </BarChart>
        );
    }
  };

  return (
    <div style={{ height: '300px', width: '100%', marginTop: '20px', padding: '20px', background: 'white', border: '1px solid #eee', borderRadius: '8px' }}>
      <h4 style={{ textAlign: 'center', margin: 0 }}>Visualizing: {config.yAxis} by {config.xAxis}</h4>
      <ResponsiveContainer width="100%" height="100%">
        {renderChart()}
      </ResponsiveContainer>
    </div>
  );
}