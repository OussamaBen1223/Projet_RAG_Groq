import React from 'react';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { supabase } from '../supabaseClient';
import './Login.css';

const Login = () => {
    return (
        <div className="login-container">
            <div className="login-card">
                <h1 className="login-title">Projet RAG Groq</h1>
                <p className="login-subtitle">Connectez-vous pour commencer à chatter avec vos documents</p>
                <Auth
                    supabaseClient={supabase}
                    appearance={{ theme: ThemeSupa }}
                    providers={['google', 'github']}
                    localization={{
                        variables: {
                            sign_in: {
                                email_label: 'Adresse e-mail',
                                password_label: 'Mot de passe',
                                button_label: 'Se connecter',
                                loading_button_label: 'Connexion...',
                                social_provider_text: 'Se connecter avec {{provider}}',
                                link_text: "Vous avez déjà un compte ? Connectez-vous",
                            },
                            sign_up: {
                                email_label: 'Adresse e-mail',
                                password_label: 'Mot de passe',
                                button_label: "S'inscrire",
                                loading_button_label: "Inscription...",
                                social_provider_text: "S'inscrire avec {{provider}}",
                                link_text: "Pas encore de compte ? Inscrivez-vous",
                            },
                        },
                    }}
                />
            </div>
        </div>
    );
};

export default Login;
