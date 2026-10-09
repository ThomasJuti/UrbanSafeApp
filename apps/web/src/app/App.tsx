import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router';
import { DeliveryPage } from '../pages/DeliveryPage';
import { ReportPage } from '../pages/ReportPage';
import { BrandMark } from '../shared/BrandMark';

function Shell() {
  return (
    <>
      <Outlet />
      <BrandMark />
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <Navigate to="/reportar" replace /> },
      { path: '/reportar', element: <ReportPage /> },
      { path: '/domiciliario', element: <DeliveryPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
