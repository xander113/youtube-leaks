import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Layout from '@/Root';
import { Browse, Search } from '@/pages/Browse';
import { Watch } from '@/pages/Watch';
import { SignIn, Plans } from '@/pages/Account';
import { Library, Support } from '@/pages/Library';
import { Admin } from '@/pages/Admin';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Browse />} />
          <Route path="search" element={<Search />} />
          <Route path=":type/:id" element={<Watch />} />
          <Route path="signin" element={<SignIn mode="login" />} />
          <Route path="join" element={<SignIn mode="register" />} />
          <Route path="plans" element={<Plans />} />
          <Route path="library" element={<Library />} />
          <Route path="support" element={<Support />} />
          <Route path="admin" element={<Admin />} />
          <Route path="*" element={<p className="status">Page not found.</p>} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
