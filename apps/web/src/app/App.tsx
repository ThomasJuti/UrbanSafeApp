import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { ReportPage } from '../pages/ReportPage';

const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/reportar" replace /> },
  { path: '/reportar', element: <ReportPage /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
