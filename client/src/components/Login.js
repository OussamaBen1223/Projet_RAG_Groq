import React from 'react';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { supabase } from '../supabaseClient';
import { motion } from 'framer-motion';

const Login = () => {
    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4 transition-colors duration-300">
            <motion.div 
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="w-full max-w-md bg-white dark:bg-slate-800 p-8 rounded-3xl shadow-xl border border-slate-200 dark:border-slate-700"
            >
                <div className="text-center mb-8">
                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                        className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/50 rounded-2xl flex items-center justify-center mx-auto mb-4"
                    >
                        <span className="text-3xl">🤖</span>
                    </motion.div>
                    <h1 className="text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight mb-2">Projet RAG Groq</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Connectez-vous pour commencer à interagir avec vos documents intelligents.</p>
                </div>
                
                <div className="auth-container-override">
                    <Auth
                        supabaseClient={supabase}
                        appearance={{ 
                            theme: ThemeSupa,
                            variables: {
                                default: {
                                    colors: {
                                        brand: '#4f46e5',
                                        brandAccent: '#4338ca',
                                    },
                                    radii: {
                                        borderRadiusButton: '0.75rem',
                                        buttonBorderRadius: '0.75rem',
                                        inputBorderRadius: '0.75rem',
                                    }
                                }
                            }
                        }}
                        providers={['google', 'github']}
                        localization={{
                            variables: {
                                sign_in: {
                                    email_label: 'Adresse e-mail',
                                    password_label: 'Mot de passe',
                                    button_label: 'Se connecter',
                                    loading_button_label: 'Connexion...',
                                    social_provider_text: 'Continuer avec {{provider}}',
                                    link_text: "Vous avez déjà un compte ? Connectez-vous",
                                },
                                sign_up: {
                                    email_label: 'Adresse e-mail',
                                    password_label: 'Mot de passe',
                                    button_label: "Créer un compte",
                                    loading_button_label: "Inscription...",
                                    social_provider_text: "S'inscrire avec {{provider}}",
                                    link_text: "Pas encore de compte ? Inscrivez-vous",
                                },
                            },
                        }}
                    />
                </div>
            </motion.div>
        </div>
    );
};

export default Login;
