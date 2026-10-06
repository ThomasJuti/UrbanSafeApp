import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { DeliveryPage } from '../pages/DeliveryPage';
import { ReportPage } from '../pages/ReportPage';

const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/reportar" replace /> },
  { path: '/reportar', element: <ReportPage /> },
  { path: '/domiciliario', element: <DeliveryPage /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
